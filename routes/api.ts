import type { Router } from '@stacksjs/bun-router';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isPathSafe,
  getDirSize,
  HOME,
  exec,
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
import { runDiskScan } from '../workers/disk-worker-pool';
import { listApplicationEntries } from '@system-cleaner/core';
import { cleanDirectory, emptyTrash } from '@system-cleaner/clean';
import {
  killProcess,
  toggleStartupItem,
  removeStartupItem,
} from '@system-cleaner/uninstall';
import { scanDirectory } from '@system-cleaner/disk';
import { getTopProcesses, summarizeProcesses } from '@system-cleaner/monitor';

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
  // ── System info (lightweight, for shell sidebar) ─────────────

  await router.get('/system-info', async () => {
    const os = await import('node:os');
    const { execSync } = await import('@system-cleaner/core');
    return Response.json({
      username: os.default.userInfo().username,
      macosVersion: execSync('sw_vers -productVersion') || 'Unknown',
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

    let scanRoot = HOME;
    let maxDepth = 6;
    if (body.path && typeof body.path === 'string') {
      const resolved = path.resolve(body.path);
      if (resolved.startsWith(HOME) || resolved === '/' || resolved.startsWith('/Volumes')) {
        scanRoot = resolved;
      }
    }
    if (typeof body.maxDepth === 'number' && body.maxDepth >= 2 && body.maxDepth <= 10) {
      maxDepth = body.maxDepth;
    }

    const HARD_TIMEOUT_MS = 60_000;
    const WORKER_TIMEOUT_MS = 50_000;

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
    return Response.json({ ...result, pid });
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

  await router.post('/dashboard-stats', async () => {
    const cached = dashboardStatsCache.get('stats');
    if (cached) return Response.json({ success: true, ...cached, cached: true });

    const os = await import('node:os');
    const procs = await getTopProcesses(8);
    const base = getDashboardStatsCached();
    const totalCPU = procs.reduce((s, p) => s + p.cpuPercent, 0);
    const cpuCores = os.default.cpus().length;
    const memPercent = Math.round(((os.default.totalmem() - os.default.freemem()) / os.default.totalmem()) * 100);
    const cpuAvgPercent = cpuCores > 0 ? Math.round(totalCPU / cpuCores) : 0;

    let dUsedPct = 0;
    try {
      const { execSync } = await import('@system-cleaner/core');
      const dfOut = execSync('df -k / 2>/dev/null');
      const parts = dfOut.split('\n')[1]?.split(/\s+/);
      if (parts) {
        const total = Number.parseInt(parts[1], 10) * 1024;
        const free = Number.parseInt(parts[3], 10) * 1024;
        dUsedPct = total > 0 ? Math.round((1 - free / total) * 100) : 0;
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

    let diskTotal = '—';
    let diskUsed = '—';
    let diskAvail = '—';
    let diskPercent = 0;
    try {
      const { execSync } = await import('@system-cleaner/core');
      const dfLine = execSync('df -h / | tail -1');
      const dfParts = dfLine.split(/\s+/);
      diskTotal = dfParts[1] || '—';
      diskUsed = dfParts[2] || '—';
      diskAvail = dfParts[3] || '—';
      diskPercent = Number.parseInt(dfParts[4]) || 0;
    }
    catch {}

    const payload = {
      ...base,
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
    return Response.json({ success: true, ...payload });
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
