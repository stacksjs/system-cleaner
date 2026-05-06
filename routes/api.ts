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
} from '@system-cleaner/core';
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
    const worker = new Worker(
      new URL('../workers/disk-scan.ts', import.meta.url).href,
    );

    return new Promise<Response>((resolve) => {
      const finish = (response: Response) => {
        diskScanInFlight = false;
        resolve(response);
      };

      const timeout = setTimeout(() => {
        worker.terminate();
        finish(Response.json({ success: false, error: `Scan exceeded ${HARD_TIMEOUT_MS / 1000}s` }));
      }, HARD_TIMEOUT_MS);

      worker.onmessage = (e: MessageEvent) => {
        clearTimeout(timeout);
        worker.terminate();
        finish(Response.json(e.data));
      };

      worker.onerror = (e: ErrorEvent) => {
        clearTimeout(timeout);
        worker.terminate();
        finish(Response.json({ success: false, error: e.message || 'Scan failed' }));
      };

      // Catch structured-clone failures (huge tree → can't be serialized
      // back to the main thread). Without this they silently hung until
      // the route timeout fired.
      (worker as Worker & { onmessageerror?: (e: MessageEvent) => void }).onmessageerror = () => {
        clearTimeout(timeout);
        worker.terminate();
        finish(Response.json({ success: false, error: 'Scan result was too large to transfer' }));
      };

      worker.postMessage({ home: scanRoot, maxDepth, timeoutMs: WORKER_TIMEOUT_MS });
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
    return Response.json(result);
  });

  await router.post('/dir-sizes', async (req: Request) => {
    const body = await readJsonBody<{ paths: unknown }>(req);
    if (body === null) return badJson();
    const paths = sanitizeStringArray(body.paths, 1024);
    if (paths === null) return badRequest('paths must be a non-empty string array (≤1024)');

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
    return Response.json({ success: true, sizes: results });
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
  });

  await router.post('/brew-update-all', async () => {
    try {
      const proc = Bun.spawn(['bash', '-c', 'brew upgrade 2>&1'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      return Response.json({
        success: exitCode === 0,
        output: output.trim().split('\n').slice(-5).join('\n'),
        error: exitCode !== 0 ? 'Some packages failed to update' : undefined,
      });
    }
    catch (err: any) {
      return Response.json({ success: false, error: err.message || 'Upgrade failed' });
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
  });

  // ── System apps with sizes ───────────────────────────────────

  await router.post('/system-apps', async () => {
    const apps: {
      name: string
      sizeBytes: number
    }[] = [];
    try {
      const entries = fs.readdirSync('/Applications').filter((e: string) => e.endsWith('.app')).sort();
      const BATCH = 10;
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(async (entry: string) => {
            const name = entry.replace(/\.app$/, '');
            let sizeBytes = 0;
            try {
              sizeBytes = await getDirSize(path.resolve('/Applications', entry));
            }
            catch {}
            return { name, sizeBytes };
          }),
        );
        apps.push(...results);
      }
    }
    catch {}
    return Response.json({ success: true, apps });
  });

  // ── Updates check (brew, pantry, desktop apps) ───────────────

  await router.post('/updates-check', async () => {
    // App name → Homebrew cask token mapping
    const CASK_MAP: Record<string, string> = {
      '1Password': '1password', '1Password 7': '1password',
      'Alacritty': 'alacritty', 'Alfred': 'alfred',
      'Android Studio': 'android-studio', 'AppCleaner': 'appcleaner',
      'Arc': 'arc', 'Audacity': 'audacity',
      'BBEdit': 'bbedit', 'Bartender': 'bartender',
      'Bear': 'bear', 'BetterTouchTool': 'bettertouchtool',
      'Brave Browser': 'brave-browser',
      'CLion': 'clion', 'Caffeine': 'caffeine',
      'ChatGPT': 'chatgpt', 'Claude': 'claude',
      'CleanMyMac': 'cleanmymac', 'CleanMyMac X': 'cleanmymac',
      'CleanShot X': 'cleanshot', 'CotEditor': 'coteditor',
      'Cursor': 'cursor', 'Cyberduck': 'cyberduck',
      'Dash': 'dash', 'DataGrip': 'datagrip',
      'DaVinci Resolve': 'davinci-resolve',
      'Discord': 'discord', 'Docker': 'docker',
      'Dropbox': 'dropbox', 'Dynobase': 'dynobase',
      'Fantastical': 'fantastical', 'Figma': 'figma',
      'Firefox': 'firefox', 'Fork': 'fork', 'ForkLift': 'forklift',
      'Ghostty': 'ghostty', 'GitHub Desktop': 'github',
      'GitKraken': 'gitkraken', 'GoLand': 'goland',
      'Google Chrome': 'google-chrome', 'Google Drive': 'google-drive',
      'Grammarly Desktop': 'grammarly-desktop',
      'HTTPie': 'httpie', 'HandBrake': 'handbrake',
      'Hyper': 'hyper',
      'IINA': 'iina', 'ImageOptim': 'imageoptim',
      'IntelliJ IDEA': 'intellij-idea', 'Insomnia': 'insomnia',
      'Joplin': 'joplin',
      'Kap': 'kap', 'Karabiner-Elements': 'karabiner-elements',
      'Keka': 'keka', 'Kitty': 'kitty',
      'Linear': 'linear-linear', 'Logseq': 'logseq',
      'Logi Options+': 'logi-options-plus',
      'logioptionsplus': 'logi-options-plus',
      'Logi Options Plus': 'logi-options-plus',
      'Loom': 'loom',
      'Maccy': 'maccy', 'MediaInfo': 'mediainfo',
      'Microsoft Edge': 'microsoft-edge',
      'Microsoft Teams': 'microsoft-teams',
      'MonitorControl': 'monitorcontrol', 'Mullvad VPN': 'mullvad-vpn',
      'Muzzle': 'muzzle',
      'NordVPN': 'nordvpn', 'Notion': 'notion', 'Nova': 'nova',
      'Numi': 'numi',
      'OBS': 'obs', 'Obsidian': 'obsidian',
      'OneDrive': 'onedrive', 'Opera': 'opera',
      'OrbStack': 'orbstack', 'Orion': 'orion',
      'Parallels Desktop': 'parallels',
      'Pearcleaner': 'pearcleaner', 'PhpStorm': 'phpstorm',
      'Plex': 'plex', 'Postman': 'postman',
      'Proxyman': 'proxyman', 'PyCharm': 'pycharm',
      'Raycast': 'raycast', 'Rectangle': 'rectangle',
      'Rider': 'rider', 'RubyMine': 'rubymine',
      'Sequel Ace': 'sequel-ace',
      'Setapp': 'setapp', 'Shottr': 'shottr',
      'Signal': 'signal', 'Sketch': 'sketch',
      'Skype': 'skype', 'Slack': 'slack',
      'SourceTree': 'sourcetree', 'Spotify': 'spotify',
      'Steam': 'steam', 'Sublime Merge': 'sublime-merge',
      'Sublime Text': 'sublime-text',
      'TablePlus': 'tableplus', 'Tailscale': 'tailscale',
      'Telegram': 'telegram', 'The Unarchiver': 'the-unarchiver',
      'Things3': 'things', 'Things': 'things',
      'TickTick': 'ticktick', 'Tinkerwell': 'tinkerwell',
      'Todoist': 'todoist', 'Tower': 'tower',
      'Transmit': 'transmit', 'Typora': 'typora',
      'UTM': 'utm',
      'VLC': 'vlc', 'VMware Fusion': 'vmware-fusion',
      'Visual Studio Code': 'visual-studio-code',
      'Vivaldi': 'vivaldi',
      'Warp': 'warp', 'WebStorm': 'webstorm',
      'WhatsApp': 'whatsapp', 'WireGuard': 'wireguard-go',
      'Zed': 'zed', 'Zen Browser': 'zen-browser',
      'Zoom': 'zoom', 'iTerm': 'iterm2',
      'iStat Menus': 'istat-menus',
    };

    const SYSTEM_APPS = new Set([
      'Safari', 'Preview', 'TextEdit', 'Automator', 'Font Book',
      'Migration Assistant', 'Photo Booth', 'System Preferences',
      'System Settings', 'Disk Utility', 'Terminal', 'Activity Monitor',
      'Console', 'Grapher', 'Script Editor', 'Time Machine', 'Photos',
      'Mail', 'Calendar', 'Contacts', 'Reminders', 'Notes', 'Maps',
      'Messages', 'FaceTime', 'Books', 'News', 'Stocks', 'Weather',
      'Home', 'Podcasts', 'Music', 'TV', 'Voice Memos', 'Freeform',
      'Shortcuts', 'Chess', 'Dictionary', 'Stickies', 'Image Capture',
      'Color Picker', 'Simulator', 'Simulator (Watch)',
    ]);

    const MAS_APPS = new Set([
      'Xcode', 'Numbers', 'Pages', 'Keynote', 'GarageBand', 'iMovie',
      'Grammarly for Safari', 'AdBlock', 'HP Smart', 'Audible',
      'CleanMyMac_5_MAS', 'Mini Motorways', 'Snake.io+',
      'Numbers Creator Studio', 'Things3',
    ]);

    function isNewerVersion(latest: string, current: string): boolean {
      if (!latest || !current || latest === current) return false;
      if (current === '?') return !!latest;
      const norm = (v: string) => v.replace(/[,+].*/g, '').replace(/-.*$/, '').split('.').map(n => parseInt(n, 10) || 0);
      const a = norm(latest);
      const b = norm(current);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) > (b[i] || 0)) return true;
        if ((a[i] || 0) < (b[i] || 0)) return false;
      }
      return false;
    }

    // Run brew outdated, pantry outdated, and app plist reads concurrently
    const entries = (() => {
      try {
        return fs.readdirSync('/Applications').filter((e: string) => e.endsWith('.app'));
      }
      catch {
        return [];
      }
    })();

    const [brewResult, pantryResult, pantryPkgs, rawApps] = await Promise.all([
      exec('brew outdated --json 2>/dev/null', { timeout: 30000 }),
      exec('pantry outdated 2>/dev/null', { timeout: 10000 }),
      (async () => {
        try {
          const globalDir = path.join(HOME, '.pantry/global/packages');
          return fs.existsSync(globalDir) ? fs.readdirSync(globalDir) : [];
        }
        catch {
          return [] as string[];
        }
      })(),
      Promise.all(entries.map(async (app: string) => {
        const name = app.replace(/\.app$/, '');
        if (SYSTEM_APPS.has(name)) return null;
        let version = '?';
        try {
          const plistPath = `/Applications/${app}/Contents/Info.plist`;
          if (fs.existsSync(plistPath)) {
            const r = await exec(`/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "${plistPath}" 2>/dev/null`, { timeout: 2000 });
            if (r.ok && r.stdout) version = r.stdout;
          }
        }
        catch {}
        return { name, version };
      })).then(results => results.filter((r): r is {
        name: string
        version: string
      } => r !== null)),
    ]);

    // Parse brew outdated
    const brewFormulae: {
      name: string
      current: string
      latest: string
      pinned: boolean
    }[] = [];
    const brewCasks: {
      name: string
      current: string
      latest: string
    }[] = [];
    if (brewResult.ok && brewResult.stdout) {
      try {
        const data = JSON.parse(brewResult.stdout);
        for (const f of (data.formulae || [])) {
          brewFormulae.push({ name: f.name, current: (f.installed_versions || [])[0] || '?', latest: f.current_version || '?', pinned: f.pinned || false });
        }
        for (const c of (data.casks || [])) {
          brewCasks.push({ name: c.name, current: (c.installed_versions || [])[0]?.split(',')[0] || '?', latest: c.current_version?.split(',')[0] || '?' });
        }
      }
      catch {}
    }

    // Parse pantry outdated
    const pantryOutdated: {
      name: string
      current: string
      latest: string
    }[] = [];
    if (pantryResult.ok && pantryResult.stdout) {
      const lines = pantryResult.stdout.split('\n');
      let inTable = false;
      for (const line of lines) {
        if (line.startsWith('---')) {
          inTable = true;
          continue;
        }
        if (!inTable || !line.trim() || line.startsWith('Legend') || line.startsWith('Found')) continue;
        const parts = line.trim().split(/\s{2,}/);
        if (parts.length >= 4) {
          pantryOutdated.push({
            name: parts[0].replace(/\u001b\[\d+m/g, '').trim(),
            current: parts[1].replace(/"/g, '').trim(),
            latest: parts[3].trim(),
          });
        }
      }
    }

    // Collect cask tokens to query
    const tokensToQuery: string[] = [];
    for (const app of rawApps) {
      const token = CASK_MAP[app.name];
      if (token && !tokensToQuery.includes(token)) tokensToQuery.push(token);
    }

    // Batch query brew for latest cask versions
    const caskVersions: Record<string, {
      version: string
      autoUpdates: boolean
    }> = {};
    if (tokensToQuery.length > 0) {
      const batchPromises: Promise<void>[] = [];
      for (let i = 0; i < tokensToQuery.length; i += 15) {
        const batch = tokensToQuery.slice(i, i + 15);
        batchPromises.push(
          exec(`brew info --cask --json=v2 ${batch.join(' ')} 2>/dev/null`, { timeout: 30000 })
            .then(r => {
              if (r.ok && r.stdout) {
                try {
                  const data = JSON.parse(r.stdout);
                  for (const cask of (data.casks || [])) {
                    caskVersions[cask.token] = {
                      version: (cask.version || '').split(',')[0],
                      autoUpdates: cask.auto_updates || false,
                    };
                  }
                }
                catch {}
              }
            }),
        );
      }
      await Promise.all(batchPromises);
    }

    // Build desktop apps list
    interface DesktopApp {
      name: string
      version: string
      latestVersion: string | null
      updateAvailable: boolean
      source: string
      caskToken: string | null
      autoUpdates: boolean
    }
    const desktopApps: DesktopApp[] = [];
    const desktopOutdated: DesktopApp[] = [];

    for (const app of rawApps) {
      const isMAS = MAS_APPS.has(app.name);
      const token = CASK_MAP[app.name] || null;
      const caskInfo = token ? caskVersions[token] : null;

      let source = 'unknown';
      let latestVersion: string | null = null;
      let updateAvailable = false;
      let autoUpdates = false;

      if (isMAS) {
        source = 'mas';
      }
      else if (caskInfo) {
        latestVersion = caskInfo.version;
        autoUpdates = caskInfo.autoUpdates;
        updateAvailable = isNewerVersion(latestVersion, app.version);
        source = autoUpdates ? 'auto' : 'brew';
      }

      const entry: DesktopApp = {
        name: app.name, version: app.version, latestVersion,
        updateAvailable, source, caskToken: token, autoUpdates,
      };
      desktopApps.push(entry);
      if (updateAvailable) desktopOutdated.push(entry);
    }

    desktopApps.sort((a, b) => {
      if (a.updateAvailable && !b.updateAvailable) return -1;
      if (!a.updateAvailable && b.updateAvailable) return 1;
      return a.name.localeCompare(b.name);
    });

    return Response.json({
      success: true,
      brewFormulae, brewCasks,
      pantryOutdated, pantryPackages: pantryPkgs,
      desktopApps, desktopOutdated,
    });
  });
}
