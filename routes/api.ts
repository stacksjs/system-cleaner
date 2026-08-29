import type { Router } from '@stacksjs/bun-router';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isPathSafe,
  getDirSize,
  HOME,
  sanitizePackageName,
  sanitizePid,
  sanitizeStringArray,
  TtlCache,
} from '@system-cleaner/core';
import { invalidateUpdatesCaches, getUpdatesSummary, runUpdatesCheck } from './updates-check';
import {
  getStartupItemsCached,
  getExtensionsCached,
  getSystemDiskInfoCached,
  getCleanupTargetsCached,
  getDashboardStatsCached,
  invalidateStartupCache,
} from './data-service';
import { lastScanResult, runDiskScan, runLargeFileScan, scanProgress } from '../app/Workers/scan-pool';
import { findAppBundle, findAppBundleForCask, getSystemInfoSync, ICON_SIZES, listApplicationEntries, renderAppIcon } from '@system-cleaner/core';
import * as nodeOs from 'node:os';
import { cleanDirectory, emptyTrash } from '@system-cleaner/clean';
import {
  killProcess,
  toggleStartupItem,
  removeStartupItem,
} from '@system-cleaner/uninstall';
import { categoryPresentation } from '@system-cleaner/disk';
import { getTopProcesses, summarizeProcesses } from '@system-cleaner/monitor';
import { recordSystemActivity } from '../app/Support/System/activity-chart';
import { isLocalAgent } from '../app/Support/Runtime/local-agent';
import {
  bulkDelete,
  cleanupHistory,
  listProtectedPaths,
  protectPath,
  protectedPathSet,
  unprotectPath,
  MAX_BULK_PATHS,
} from '../app/Support/Cleanup/bulk-delete';

/**
 * Safely parse a JSON request body. Returns the parsed object or `null`
 * if the body is malformed; callers turn `null` into a 400. Without this,
 * malformed-JSON requests silently fell through to handler defaults.
 */
async function readJsonBody<T>(req: Request): Promise<T | null> {
  try { return await req.json() as T }
  catch { return null }
}

const badJson = () => Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
const badRequest = (msg: string, status = 400) =>
  Response.json({ success: false, error: msg }, { status });

/**
 * Verify that a path is absolute and resolves under one of the allowed
 * roots. We don't reuse `isPathSafe` here because that helper rejects
 * symlinks and sensitive segments — fine for delete operations, wrong
 * for things like "open this in Finder".
 */
function pathInAllowedRoots(p: string, roots: string[]): boolean {
  if (!path.isAbsolute(p)) return false;
  const resolved = path.resolve(p);
  return roots.some(root => resolved === root || resolved.startsWith(`${root}/`));
}

/**
 * Single-flight gate for /disk-scan. Without it, every request spawned a
 * new Worker; an attacker (or a panicky frontend) could exhaust I/O by
 * firing parallel scans. One in-flight scan at a time is enough.
 */
let diskScanInFlight = false;

const systemAppsListCache = new TtlCache<{ name: string; sizeBytes: number | null }[]>(15 * 60_000);
const systemAppsSizesCache = new TtlCache<{ name: string; sizeBytes: number }[]>(15 * 60_000);
const dashboardStatsCache = new TtlCache<Record<string, unknown>>(30_000);
const dirSizesCache = new TtlCache<Record<string, number>>(5 * 60_000);

/**
 * API routes for SystemCleaner.
 *
 * This file is auto-discovered by bun-router from routes/api.ts.
 * The filename 'api' becomes the route prefix: /api/*
 *
 * So router.post('/disk-scan', ...) becomes POST /api/disk-scan
 */
export default async function (router: Router) {
  // Every route below acts on the machine this process runs on. On the public
  // system-cleaner.app deployment that machine is a shared web server, so the
  // control plane is simply not registered there — an unregistered route 404s,
  // which is a stronger guarantee than a handler that remembers to check.
  if (!isLocalAgent())
    return;

  // ── System info (lightweight, for shell sidebar) ─────────────

  await router.get('/system-info', async () => {
    const os = await import('node:os');
    const { execSync } = await import('@system-cleaner/core');
    return Response.json({
      username: os.default.userInfo().username,
      macosVersion: execSync('sw_vers -productVersion') || 'Unknown',
    });
  });

  /**
   * The real icon of an installed app, as a PNG.
   *
   * A GET with query parameters rather than the POST every other endpoint
   * uses, because the browser fetches this through `<img src>`.
   *
   * `?cask=` looks the bundle up by Homebrew cask token; `?name=` by display
   * name. A 404 is the expected answer for a package with no `.app` at all —
   * a CLI formula, say — and the UI falls back to a glyph.
   */
  await router.get('/app-icon', async (req: Request) => {
    const url = new URL(req.url);
    const name = url.searchParams.get('name');
    const cask = url.searchParams.get('cask');
    const requested = Number.parseInt(url.searchParams.get('size') || '64', 10);

    if (!name && !cask) return badRequest('name or cask is required');

    // Only the sizes the UI asks for: an unbounded size would let a page ask
    // for a 20000px render and spend the machine's CPU doing it.
    const size = (ICON_SIZES as readonly number[]).includes(requested)
      ? requested as typeof ICON_SIZES[number]
      : 64;

    // The lookup is by display name, and `findAppBundle` only ever returns a
    // path it enumerated from /Applications itself — a caller cannot steer it
    // at an arbitrary file.
    const appPath = cask ? findAppBundleForCask(cask) : findAppBundle(name!);
    if (!appPath) return new Response('No such app', { status: 404 });

    const png = renderAppIcon(appPath, size);
    if (!png) return new Response('No icon in bundle', { status: 404 });

    return new Response(Bun.file(png), {
      headers: {
        'Content-Type': 'image/png',
        // The cache key already includes the bundle's mtime, so a long-lived
        // client cache cannot serve a stale icon after an app updates.
        'Cache-Control': 'public, max-age=86400',
      },
    });
  });

  await router.post('/disk-scan', async (req: Request) => {
    if (diskScanInFlight) {
      return Response.json(
        { success: false, error: 'A disk scan is already in progress' },
        { status: 409 },
      );
    }

    const body = await readJsonBody<{ path?: string; maxDepth?: number }>(req);
    if (body === null) return badJson();

    // A relative path resolves against HOME, not the process CWD — which for
    // the packaged app is `/`, so `Code` became `/Code`, failed the check, and
    // silently fell back to scanning the whole home directory. Same rule as
    // `/large-files`, which the UI already relies on.
    let scanRoot = HOME;
    let maxDepth = 6;
    if (body.path && typeof body.path === 'string') {
      const resolved = path.isAbsolute(body.path)
        ? path.resolve(body.path)
        : path.resolve(HOME, body.path);
      if (resolved === HOME || resolved.startsWith(`${HOME}/`) || resolved === '/' || resolved.startsWith('/Volumes/')) {
        scanRoot = resolved;
      }
      else {
        return badRequest('Scan root must be your home directory or an external volume', 403);
      }
    }
    if (typeof body.maxDepth === 'number' && body.maxDepth >= 2 && body.maxDepth <= 10) {
      maxDepth = body.maxDepth;
    }

    // The gap is deliberate and wide: the scanner returns whatever tree it
    // built when its own budget runs out, and killing it at the hard timeout
    // throws that away. The hard timeout is the backstop for a scan wedged in
    // a blocking syscall, not the normal path.
    const HARD_TIMEOUT_MS = 75_000;
    const WORKER_TIMEOUT_MS = 45_000;

    diskScanInFlight = true;
    try {
      const result = await runDiskScan(
        { home: scanRoot, maxDepth, timeoutMs: WORKER_TIMEOUT_MS },
        HARD_TIMEOUT_MS,
      );
      return Response.json(result);
    }
    catch (err: any) {
      return Response.json({ success: false, error: err.message || 'Scan failed' });
    }
    finally {
      diskScanInFlight = false;
    }
  });

  /**
   * How far the running scan has got.
   *
   * The Disk Usage and Large Files screens poll this while they wait. A
   * full-home walk runs for tens of seconds, and a spinner that never moves is
   * indistinguishable from a hang — which is exactly how the disk scan read
   * before this existed.
   */
  /**
   * The most recent finished scan, for a screen that was not watching when it
   * landed. Navigating away tears down the page and the request with it, so
   * without this a scan that completed while the user was elsewhere was simply
   * lost and the screen sat on a spinner forever.
   */
  await router.post('/last-scan', async (req: Request) => {
    const body = await readJsonBody<{ kind?: string }>(req);
    const kind = body?.kind === 'large-files' ? 'large-files' : 'tree';
    const held = lastScanResult(kind);

    if (!held) return Response.json({ success: true, result: null });

    return Response.json({
      success: true,
      kind,
      ageMs: Date.now() - held.at,
      result: held.result,
    });
  });

  await router.post('/scan-progress', async () => {
    const progress = scanProgress();
    if (!progress) return Response.json({ success: true, scanning: false });

    return Response.json({
      success: true,
      scanning: true,
      scanned: progress.scanned,
      path: progress.path,
      kind: progress.kind,
      elapsedMs: Date.now() - progress.startedAt,
    });
  });

  await router.post('/delete-path', async (req: Request) => {
    const body = await readJsonBody<{ path: string }>(req);
    if (body === null) return badJson();
    const { path: target } = body;
    if (typeof target !== 'string' || !target) return badRequest('No path provided');

    const check = isPathSafe(target);
    if (!check.safe) return badRequest(check.reason || 'Unsafe path', 403);

    const resolved = path.resolve(target);
    let size = 0;
    try {
      const st = fs.lstatSync(resolved);
      size = st.isDirectory() ? await getDirSize(resolved) : st.size;
    }
    catch {
      return badRequest('Path does not exist', 404);
    }
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
    catch (err: any) {
      return badRequest(err.message || 'Delete failed', 500);
    }
    return Response.json({ success: true, freedBytes: size });
  });

  await router.post('/reveal-in-finder', async (req: Request) => {
    const body = await readJsonBody<{ path: string }>(req);
    if (body === null) return badJson();
    const { path: target } = body;
    if (typeof target !== 'string' || !target) return badRequest('No path');

    // Require absolute paths so a relative input like "../../etc" can't
    // be resolved against the server's CWD into something out of scope.
    if (!path.isAbsolute(target)) return badRequest('Path must be absolute', 400);

    if (!pathInAllowedRoots(target, [HOME, '/Applications', '/Volumes'])) {
      return badRequest('Outside allowed scope', 403);
    }

    try {
      Bun.spawn(['open', '-R', path.resolve(target)], { stdout: 'ignore', stderr: 'ignore' });
    }
    catch {}
    return Response.json({ success: true });
  });

  await router.post('/clean-dir', async (req: Request) => {
    const body = await readJsonBody<{ path: string }>(req);
    if (body === null) return badJson();
    const { path: target } = body;
    if (typeof target !== 'string' || !target) return badRequest('No path provided');

    // Route-level gate: only allow cleaning paths under HOME from the web
    // UI. The CLI can target /Library and /private/var/* via cleanDirectory
    // directly; the HTTP surface stays narrower.
    if (!pathInAllowedRoots(target, [HOME])) {
      return badRequest('Path must be under your home directory', 403);
    }

    const result = await cleanDirectory(target);
    return Response.json({
      success: result.errors.length === 0,
      freedBytes: result.freedBytes,
      errors: result.errors.length ? result.errors : undefined,
    });
  });

  await router.post('/kill-process', async (req: Request) => {
    const body = await readJsonBody<{ pid: unknown }>(req);
    if (body === null) return badJson();
    const pid = sanitizePid(body.pid);
    if (pid === null) return badRequest('Invalid PID');

    const result = await killProcess(pid);
    // A refused kill (someone else's process, a protected daemon) is a 403,
    // not a 200 carrying `success: false`. Every other guarded endpoint here
    // answers with a status code, and the client's error handling keys off it.
    return Response.json({ ...result, pid }, { status: result.success ? 200 : 403 });
  });

  await router.post('/toggle-startup', async (req: Request) => {
    const body = await readJsonBody<{ filepath: string; action: 'enable' | 'disable' }>(req);
    if (body === null) return badJson();
    const { filepath, action } = body;
    if (typeof filepath !== 'string' || !filepath) return badRequest('No filepath provided');
    if (action !== 'enable' && action !== 'disable') return badRequest('Invalid action');

    // The package validates again, but enforce the prefix here so an
    // attacker can't reach the (now AppleScript-escaped) launchctl path
    // with a shell-poisoned filepath that snuck past the JSON parser.
    if (!pathInAllowedRoots(filepath, [
      path.join(HOME, 'Library/LaunchAgents'),
      '/Library/LaunchAgents',
      '/Library/LaunchDaemons',
    ])) {
      return badRequest('filepath must point to a launch agent/daemon plist', 403);
    }

    const result = await toggleStartupItem(filepath, action);
    invalidateStartupCache();
    dashboardStatsCache.clear();
    return Response.json({ ...result, action });
  });

  await router.post('/remove-startup', async (req: Request) => {
    const body = await readJsonBody<{ filepath: string }>(req);
    if (body === null) return badJson();
    const { filepath } = body;
    if (typeof filepath !== 'string' || !filepath) return badRequest('No filepath provided');

    if (!pathInAllowedRoots(filepath, [
      path.join(HOME, 'Library/LaunchAgents'),
      '/Library/LaunchAgents',
      '/Library/LaunchDaemons',
    ])) {
      return badRequest('filepath must point to a launch agent/daemon plist', 403);
    }

    const result = await removeStartupItem(filepath);
    invalidateStartupCache();
    dashboardStatsCache.clear();
    return Response.json(result);
  });

  await router.post('/dir-sizes', async (req: Request) => {
    const body = await readJsonBody<{ paths: unknown }>(req);
    if (body === null) return badJson();
    const paths = sanitizeStringArray(body.paths, 1024);
    if (paths === null) return badRequest('paths must be a non-empty string array (≤1024)');

    const cacheKey = paths.slice().sort().join('\0');
    const cached = dirSizesCache.get(cacheKey);
    if (cached) return Response.json({ success: true, sizes: cached, cached: true });

    const results: Record<string, number> = {};
    // Bound parallelism so we don't fire 1024 simultaneous `du` walks.
    const CONCURRENCY = 8;
    for (let i = 0; i < paths.length; i += CONCURRENCY) {
      const slice = paths.slice(i, i + CONCURRENCY);
      await Promise.all(
        slice.map(async (p) => {
          const resolved = path.resolve(p);
          if (!resolved.startsWith(HOME)) return;
          try { results[p] = await getDirSize(resolved); }
          catch { results[p] = 0; }
        }),
      );
    }
    dirSizesCache.set(cacheKey, results);
    return Response.json({ success: true, sizes: results, cached: false });
  });

  await router.post('/empty-trash', async () => {
    const result = await emptyTrash();
    return Response.json({
      success: result.success,
      freedBytes: result.freedBytes,
    });
  });

  // ── Large files: find, protect, bulk-delete ──────────────────

  /**
   * Single-flight gate, same reasoning as `/disk-scan`: one full-home walk at
   * a time is plenty, and the two share a worker anyway.
   */
  let largeFileScanInFlight = false;

  await router.post('/large-files', async (req: Request) => {
    if (largeFileScanInFlight) {
      return Response.json(
        { success: false, error: 'A scan is already in progress' },
        { status: 409 },
      );
    }

    const body = await readJsonBody<{
      path?: unknown
      minSizeMB?: unknown
      limit?: unknown
      categories?: unknown
    }>(req);
    if (body === null) return badJson();

    // A relative path is resolved against HOME rather than the server's CWD,
    // so the UI can send 'Downloads' without knowing where home is.
    let root = HOME;
    if (typeof body.path === 'string' && body.path) {
      const resolved = path.isAbsolute(body.path)
        ? path.resolve(body.path)
        : path.resolve(HOME, body.path);
      if (resolved === HOME || resolved.startsWith(`${HOME}/`) || resolved.startsWith('/Volumes/')) {
        root = resolved;
      }
      else {
        return badRequest('Scan root must be your home directory or an external volume', 403);
      }
    }

    // Floor of 1 MB: below that the walk returns tens of thousands of rows the
    // UI cannot usefully render and the user cannot usefully review.
    const minSizeMB = typeof body.minSizeMB === 'number' && body.minSizeMB >= 1 && body.minSizeMB <= 1_000_000
      ? body.minSizeMB
      : 100;
    const limit = typeof body.limit === 'number' && body.limit >= 10 && body.limit <= 1000
      ? Math.floor(body.limit)
      : 200;
    const categories = sanitizeStringArray(body.categories, 32) ?? undefined;

    // The worker gets 45s to walk and return whatever it found; the pool waits
    // 60s before terminating it outright. The gap matters: a `readdirSync` on a
    // dataless cloud placeholder blocks in the kernel, where the scan's own
    // deadline cannot reach it, and terminating the worker is the only way back.
    const HARD_TIMEOUT_MS = 60_000;
    const WORKER_TIMEOUT_MS = 45_000;

    largeFileScanInFlight = true;
    try {
      const [result, protectedPaths] = await Promise.all([
        runLargeFileScan(
          {
            roots: [root],
            minSizeBytes: Math.round(minSizeMB * 1024 * 1024),
            limit,
            timeoutMs: WORKER_TIMEOUT_MS,
            categories,
          },
          HARD_TIMEOUT_MS,
        ),
        protectedPathSet(),
      ]);

      if (!result.success) {
        return Response.json({ success: false, error: result.error || 'Scan failed' });
      }

      return Response.json({
        success: true,
        root,
        minSizeMB,
        scanned: result.scanned,
        matched: result.matched,
        totalBytes: result.totalBytes,
        truncated: result.truncated,
        scanTime: result.scanTime,
        // The protected flag is joined here rather than in the worker: the
        // worker has no database, and the list is small enough that a set
        // lookup per row costs nothing.
        files: (result.files ?? []).map(file => ({
          ...file,
          ...categoryPresentation(file.category),
          protected: protectedPaths.has(file.path),
        })),
      });
    }
    catch (err: any) {
      // A terminated worker has no partial result to hand back, so the message
      // has to carry the next step rather than just the failure.
      const message = /exceeded/.test(err?.message ?? '')
        ? `${err.message}. Pick a single folder under "Search in" to scan it completely.`
        : err?.message || 'Scan failed';
      return Response.json({ success: false, error: message });
    }
    finally {
      largeFileScanInFlight = false;
    }
  });

  await router.post('/bulk-delete', async (req: Request) => {
    const body = await readJsonBody<{ paths: unknown; mode?: unknown; source?: unknown }>(req);
    if (body === null) return badJson();

    const paths = sanitizeStringArray(body.paths, MAX_BULK_PATHS);
    if (paths === null)
      return badRequest(`paths must be a non-empty string array (≤${MAX_BULK_PATHS})`);

    // Permanent deletion has to be asked for by name. Defaulting to it would
    // turn a mis-click into an unrecoverable one.
    const mode = body.mode === 'permanent' ? 'permanent' : 'trash';
    const source = typeof body.source === 'string' && /^[a-z-]{1,32}$/.test(body.source)
      ? body.source
      : 'large-files';

    const result = await bulkDelete(paths, mode, source);
    return Response.json({
      success: result.failed.length === 0,
      mode,
      ...result,
    });
  });

  await router.post('/protected-paths', async () => {
    return Response.json({ success: true, paths: await listProtectedPaths() });
  });

  await router.post('/protect-path', async (req: Request) => {
    const body = await readJsonBody<{ path: unknown; reason?: unknown }>(req);
    if (body === null) return badJson();
    if (typeof body.path !== 'string' || !body.path) return badRequest('No path provided');
    if (!path.isAbsolute(body.path)) return badRequest('Path must be absolute');

    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 255) : undefined;
    return Response.json({ success: true, ...await protectPath(body.path, reason) });
  });

  await router.post('/unprotect-path', async (req: Request) => {
    const body = await readJsonBody<{ path: unknown }>(req);
    if (body === null) return badJson();
    if (typeof body.path !== 'string' || !body.path) return badRequest('No path provided');

    return Response.json({ success: true, ...await unprotectPath(body.path) });
  });

  await router.post('/cleanup-history', async () => {
    return Response.json({ success: true, ...await cleanupHistory() });
  });

  // ── Live process data ───────────────────────────────────────

  await router.post('/live-processes', async () => {
    const procs = await getTopProcesses(20);
    const summary = summarizeProcesses(procs);
    return Response.json({
      processes: procs.map((p) => ({
        id: `proc-${p.pid}`,
        pid: p.pid,
        name: p.name,
        fullCommand: p.fullCommand,
        user: p.user,
        cpu: p.cpuPercent,
        memMB: p.memoryMB,
        isSystem: p.isSystem,
      })),
      totalCPU: summary.totalCpuPercent,
      totalMemUsed: summary.totalMemoryMB,
    });
  });

  // ── Brew update endpoints ──────────────────────────────────

  await router.post('/brew-update', async (req: Request) => {
    const body = await readJsonBody<{ name: unknown; type: unknown }>(req);
    if (body === null) return badJson();

    const name = sanitizePackageName(body.name);
    if (name === null) return badRequest('Invalid package name');
    if (body.type !== 'formula' && body.type !== 'cask') return badRequest('Invalid package type');

    try {
      // argv form — no shell expansion, name can never become its own command.
      const upgradeArgs = body.type === 'cask'
        ? ['brew', 'upgrade', '--cask', name]
        : ['brew', 'upgrade', name];
      const proc = Bun.spawn(upgradeArgs, { stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      const output = (stdout + stderr).trim();

      if (exitCode !== 0) {
        return Response.json({ success: false, error: output.split('\n').pop() || 'Upgrade failed' });
      }

      const verArgs = body.type === 'cask'
        ? ['brew', 'info', '--cask', '--json=v2', name]
        : ['brew', 'info', '--json=v2', name];
      const verProc = Bun.spawn(verArgs, { stdout: 'pipe', stderr: 'ignore' });
      const verOutput = await new Response(verProc.stdout).text();
      let version = 'latest';
      try {
        const info = JSON.parse(verOutput);
        if (body.type === 'cask') {
          version = info.casks?.[0]?.version?.split(',')?.[0] || 'latest';
        }
        else {
          version = info.formulae?.[0]?.versions?.stable || 'latest';
        }
      }
      catch {}

      return Response.json({ success: true, version });
    }
    catch (err: any) {
      return Response.json({ success: false, error: err.message || 'Upgrade failed' });
    }
    finally {
      invalidateUpdatesCaches();
    }
  });

  await router.post('/brew-update-all', async () => {
    try {
      const proc = Bun.spawn(['brew', 'upgrade'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const output = (stdout + stderr).trim();
      const exitCode = await proc.exited;

      return Response.json({
        success: exitCode === 0,
        output: output.split('\n').slice(-5).join('\n'),
        error: exitCode !== 0 ? 'Some packages failed to update' : undefined,
      });
    }
    catch (err: any) {
      return Response.json({ success: false, error: err.message || 'Upgrade failed' });
    }
    finally {
      invalidateUpdatesCaches();
    }
  });

  // ── Pantry update endpoint ─────────────────────────────────

  await router.post('/pantry-update', async (req: Request) => {
    const body = await readJsonBody<{ name: unknown }>(req);
    if (body === null) return badJson();

    const name = sanitizePackageName(body.name);
    if (name === null) return badRequest('Invalid package name');

    try {
      // argv form (no shell). Stderr is captured separately so the failure
      // line doesn't get lost in the success-path "tail".
      const proc = Bun.spawn(['pantry', 'update', name], { stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      const output = (stdout + stderr).trim();

      return Response.json({
        success: exitCode === 0,
        output: output.split('\n').slice(-3).join('\n'),
        error: exitCode !== 0 ? (output.split('\n').pop() || 'Update failed') : undefined,
      });
    }
    catch (err: any) {
      return Response.json({ success: false, error: err.message || 'Update failed' });
    }
    finally {
      invalidateUpdatesCaches();
    }
  });

  // ── Desktop app update endpoint ──────────────────────────────

  await router.post('/app-update', async (req: Request) => {
    const body = await readJsonBody<{ name?: unknown; caskToken: unknown }>(req);
    if (body === null) return badJson();

    const safeCaskToken = sanitizePackageName(body.caskToken);
    if (safeCaskToken === null) return badRequest('Invalid cask token');

    try {
      // argv form, no shell.
      const runBrew = async (action: 'upgrade' | 'install') => {
        const proc = Bun.spawn(['brew', action, '--cask', safeCaskToken], {
          stdout: 'pipe', stderr: 'pipe',
        });
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        return { output: (stdout + stderr).trim(), exitCode: await proc.exited };
      };

      let { output, exitCode } = await runBrew('upgrade');
      if (exitCode !== 0 && (output.includes('not installed') || output.includes('No available'))) {
        ({ output, exitCode } = await runBrew('install'));
      }

      if (exitCode !== 0) {
        return Response.json({
          success: false,
          error: output.split('\n').pop() || 'Update failed',
        });
      }

      const verProc = Bun.spawn(
        ['brew', 'info', '--cask', '--json=v2', safeCaskToken],
        { stdout: 'pipe', stderr: 'ignore' },
      );
      const verOutput = await new Response(verProc.stdout).text();
      let version = 'latest';
      try {
        const info = JSON.parse(verOutput);
        version = info.casks?.[0]?.version?.split(',')?.[0] || 'latest';
      }
      catch {}

      return Response.json({ success: true, version });
    }
    catch (err: any) {
      return Response.json({ success: false, error: err.message || 'Update failed' });
    }
    finally {
      invalidateUpdatesCaches();
    }
  });

  // ── Dashboard stats (cached, client-fetched) ─────────────────

  /**
   * Facts about this Mac that do not change often enough to recompute per
   * request, but which the prerendered HTML cannot know.
   */
  function getHostSnapshot() {
    const info = getSystemInfoSync();
    const totalBytes = info.totalMemoryBytes;
    const freeBytes = nodeOs.freemem();
    const uptimeHours = Math.round(info.uptimeSeconds / 3600);
    const uptimeDays = Math.floor(uptimeHours / 24);

    return {
      hostname: info.hostname,
      macosVersion: info.macosVersion,
      cpuLabel: info.cpuModel.split(' ').slice(0, 3).join(' '),
      cpuCores: info.cpuCores,
      totalMemGB: Math.round(totalBytes / 1e9),
      usedMemGB: ((totalBytes - freeBytes) / 1e9).toFixed(1),
      freeMemGB: (freeBytes / 1e9).toFixed(1),
      uptimeStr: uptimeDays > 0 ? `${uptimeDays}d ${uptimeHours % 24}h` : `${uptimeHours}h`,
    };
  }

  await router.post('/dashboard-stats', async () => {
    const cached = dashboardStatsCache.get('stats');
    if (cached) {
      return Response.json({
        success: true,
        ...cached,
        systemHistory: recordSystemActivity(Number(cached.cpuAvgPercent), Number(cached.memPercent)),
        cached: true,
      });
    }

    const os = await import('node:os');
    const procs = await getTopProcesses(8);
    const base = getDashboardStatsCached();
    const host = getHostSnapshot();
    const totalCPU = procs.reduce((s, p) => s + p.cpuPercent, 0);
    const cpuCores = os.default.cpus().length;
    const memPercent = Math.round(((os.default.totalmem() - os.default.freemem()) / os.default.totalmem()) * 100);
    const cpuAvgPercent = cpuCores > 0 ? Math.round(totalCPU / cpuCores) : 0;

    // Read the boot volume once, in bytes, and derive every label from it.
    // `df -h`'s own "Used" column is not usable here: on APFS the root
    // volume is the read-only system snapshot (~12Gi) while "Avail" reports
    // the shared container, so the two columns describe different things.
    let dUsedPct = 0;
    let diskTotalBytes = 0;
    let diskFreeBytes = 0;
    try {
      const { execSync } = await import('@system-cleaner/core');
      const dfOut = execSync('df -k / 2>/dev/null');
      const parts = dfOut.split('\n')[1]?.split(/\s+/);
      if (parts) {
        diskTotalBytes = Number.parseInt(parts[1], 10) * 1024;
        diskFreeBytes = Number.parseInt(parts[3], 10) * 1024;
        dUsedPct = diskTotalBytes > 0 ? Math.round((1 - diskFreeBytes / diskTotalBytes) * 100) : 0;
      }
    }
    catch {}

    let healthDeductions = 0;
    if (cpuAvgPercent > 70) healthDeductions += Math.min(30, Math.round(((cpuAvgPercent - 70) / 30) * 30));
    else if (cpuAvgPercent > 30) healthDeductions += Math.min(15, Math.round(((cpuAvgPercent - 30) / 40) * 15));
    if (memPercent > 80) healthDeductions += Math.min(25, Math.round(((memPercent - 80) / 20) * 25));
    else if (memPercent > 50) healthDeductions += Math.min(12, Math.round(((memPercent - 50) / 30) * 12));
    if (dUsedPct > 90) healthDeductions += Math.min(20, Math.round(((dUsedPct - 90) / 10) * 20));
    else if (dUsedPct > 70) healthDeductions += Math.min(10, Math.round(((dUsedPct - 70) / 20) * 10));
    if (base.enabledStartup > 20) healthDeductions += Math.min(5, Math.floor((base.enabledStartup - 20) / 10));
    const healthScore = Math.max(0, Math.min(100, 100 - healthDeductions));

    const { formatBytes } = await import('@system-cleaner/core');
    const diskTotal = diskTotalBytes > 0 ? formatBytes(diskTotalBytes) : '-';
    const diskUsed = diskTotalBytes > 0 ? formatBytes(diskTotalBytes - diskFreeBytes) : '-';
    const diskAvail = diskTotalBytes > 0 ? formatBytes(diskFreeBytes) : '-';
    const diskPercent = dUsedPct;

    const payload = {
      ...base,
      // Host facts travel with the stats rather than being rendered into the
      // page. The packaged app ships prerendered HTML, so anything a
      // `<script server>` block computed would be the *build machine's* CPU,
      // memory, and uptime frozen at build time.
      ...host,
      healthScore,
      memPercent,
      dUsedPct,
      diskTotal,
      diskUsed,
      diskAvail,
      diskPercent,
      cpuAvgPercent,
      processes: procs.map(p => ({
        id: `proc-${p.pid}`,
        pid: p.pid,
        name: p.name,
        fullCommand: p.fullCommand,
        user: p.user,
        cpu: p.cpuPercent,
        memMB: p.memoryMB,
        isSystem: p.isSystem,
      })),
      cached: false,
    };
    dashboardStatsCache.set('stats', payload);
    return Response.json({
      success: true,
      ...payload,
      systemHistory: recordSystemActivity(cpuAvgPercent, memPercent),
    });
  });

  await router.post('/startup-items', async () => {
    const { items, cached } = getStartupItemsCached();
    return Response.json({ success: true, items, cached });
  });

  await router.post('/extensions-list', async () => {
    const { extensions, cached } = getExtensionsCached();
    return Response.json({ success: true, extensions, cached });
  });

  await router.post('/system-disk-info', async () => {
    const info = getSystemDiskInfoCached();
    return Response.json({ success: true, ...info });
  });

  await router.post('/cleanup-targets', async () => {
    const { targets, cached } = getCleanupTargetsCached();
    return Response.json({ success: true, targets, cached });
  });

  await router.post('/system-apps', async (req: Request) => {
    const body = await readJsonBody<{ sizes?: unknown }>(req);
    const wantSizes = body?.sizes === true;

    if (!wantSizes) {
      const cached = systemAppsListCache.get('apps');
      if (cached) return Response.json({ success: true, apps: cached, sizesPending: true, cached: true });

      const apps = listApplicationEntries()
        .map(({ name }) => ({ name, sizeBytes: null as number | null }))
        .sort((a, b) => a.name.localeCompare(b.name));
      systemAppsListCache.set('apps', apps);
      return Response.json({ success: true, apps, sizesPending: true, cached: false });
    }

    const cached = systemAppsSizesCache.get('apps');
    if (cached) return Response.json({ success: true, apps: cached, sizesPending: false, cached: true });

    const apps: { name: string; sizeBytes: number }[] = [];
    const appDirs = ['/Applications', path.join(HOME, 'Applications')];
    const seen = new Set<string>();
    try {
      for (const dir of appDirs) {
        let entries: string[] = [];
        try {
          entries = fs.readdirSync(dir).filter((e: string) => e.endsWith('.app')).sort();
        }
        catch { continue; }
        const BATCH = 10;
        for (let i = 0; i < entries.length; i += BATCH) {
          const batch = entries.slice(i, i + BATCH).filter((entry) => {
            const name = entry.replace(/\.app$/, '');
            if (seen.has(name)) return false;
            seen.add(name);
            return true;
          });
          const results = await Promise.all(
            batch.map(async (entry: string) => {
              const name = entry.replace(/\.app$/, '');
              let sizeBytes = 0;
              try {
                sizeBytes = await getDirSize(path.resolve(dir, entry));
              }
              catch {}
              return { name, sizeBytes };
            }),
          );
          apps.push(...results);
        }
      }
      apps.sort((a, b) => a.name.localeCompare(b.name));
    }
    catch {}
    systemAppsSizesCache.set('apps', apps);
    return Response.json({ success: true, apps, sizesPending: false, cached: false });
  });

  // ── Open System Settings → Software Update ───────────────────

  await router.post('/open-software-update', async () => {
    try {
      const proc = Bun.spawn(
        ['open', 'x-apple.systempreferences:com.apple.Software-Update-Settings.extension'],
        { stdout: 'ignore', stderr: 'ignore' },
      );
      const exitCode = await proc.exited;
      return Response.json({ success: exitCode === 0 });
    }
    catch (err: any) {
      return Response.json({ success: false, error: err.message || 'Could not open System Settings' });
    }
  });

  await router.post('/open-app-store-updates', async () => {
    try {
      const proc = Bun.spawn(['open', 'macappstore://showUpdatesPage'], { stdout: 'ignore', stderr: 'ignore' });
      const exitCode = await proc.exited;
      return Response.json({ success: exitCode === 0 });
    }
    catch (err: any) {
      return Response.json({ success: false, error: err.message || 'Could not open App Store' });
    }
  });

  // ── Lightweight update count for sidebar / dashboard ─────────

  await router.post('/updates-summary', async () => {
    return Response.json(await getUpdatesSummary());
  });

  // ── Updates check (system, brew, pantry, desktop apps) ───────

  await router.post('/updates-check', async (req: Request) => {
    const body = await readJsonBody<{ fullScan?: unknown; forceRefresh?: unknown; tier?: unknown }>(req);
    const fullScan = body?.fullScan === true;
    const forceRefresh = body?.forceRefresh === true;
    const tier = body?.tier === 'quick' ? 'quick' : 'full';
    const result = await runUpdatesCheck(fullScan, forceRefresh, tier);
    return Response.json(result);
  });
}
