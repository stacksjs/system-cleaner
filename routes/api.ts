import type { Router } from "@stacksjs/bun-router";
import * as fs from "node:fs";
import * as path from "node:path";
import { isPathSafe, getDirSize, HOME, exec } from "@system-cleaner/core";
import { cleanDirectory, emptyTrash } from "@system-cleaner/clean";
import {
  killProcess,
  toggleStartupItem,
  removeStartupItem,
} from "@system-cleaner/uninstall";
import { scanDirectory } from "@system-cleaner/disk";
import { getTopProcesses, summarizeProcesses } from "@system-cleaner/monitor";

/**
 * API routes for SystemCleaner.
 *
 * This file is auto-discovered by bun-router from routes/api.ts.
 * The filename "api" becomes the route prefix: /api/*
 *
 * So router.post('/disk-scan', ...) becomes POST /api/disk-scan
 */
export default async function (router: Router) {
  // ── System info (lightweight, for shell sidebar) ─────────────

  await router.get("/system-info", async () => {
    const os = await import("node:os");
    const { execSync } = await import("@system-cleaner/core");
    return Response.json({
      username: os.default.userInfo().username,
      macosVersion: execSync("sw_vers -productVersion") || "Unknown",
    });
  });

  await router.post("/disk-scan", async () => {
    // Run scan in a subprocess to avoid blocking the server
    const worker = new Worker(
      new URL("../workers/disk-scan.ts", import.meta.url).href,
    );

    return new Promise<Response>((resolve) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        resolve(Response.json({ success: false, error: "Scan timed out" }));
      }, 15000);

      worker.onmessage = (e: MessageEvent) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(Response.json(e.data));
      };

      worker.onerror = (e: ErrorEvent) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(
          Response.json({ success: false, error: e.message || "Scan failed" }),
        );
      };

      worker.postMessage({ home: HOME, maxDepth: 6, timeoutMs: 12000 });
    });
  });

  await router.post("/delete-path", async (req) => {
    const { path: target } = (await req.json()) as { path: string };
    if (!target)
      return Response.json(
        { success: false, error: "No path provided" },
        { status: 400 },
      );
    const check = isPathSafe(target);
    if (!check.safe)
      return Response.json(
        { success: false, error: check.reason },
        { status: 403 },
      );
    const resolved = path.resolve(target);
    const size = await getDirSize(resolved);
    fs.rmSync(resolved, { recursive: true, force: true });
    return Response.json({ success: true, freedBytes: size });
  });

  await router.post("/clean-dir", async (req) => {
    const { path: target } = (await req.json()) as { path: string };
    if (!target)
      return Response.json(
        { success: false, error: "No path provided" },
        { status: 400 },
      );
    const result = await cleanDirectory(target);
    return Response.json({
      success: result.errors.length === 0,
      freedBytes: result.freedBytes,
      errors: result.errors.length ? result.errors : undefined,
    });
  });

  await router.post("/kill-process", async (req) => {
    const { pid } = (await req.json()) as { pid: number };
    if (!pid)
      return Response.json(
        { success: false, error: "No PID provided" },
        { status: 400 },
      );
    const result = await killProcess(pid);
    return Response.json({ ...result, pid });
  });

  await router.post("/toggle-startup", async (req) => {
    const { filepath, action } = (await req.json()) as {
      filepath: string;
      label: string;
      action: "enable" | "disable";
    };
    if (!filepath)
      return Response.json(
        { success: false, error: "No filepath provided" },
        { status: 400 },
      );
    const result = await toggleStartupItem(filepath, action);
    return Response.json({ ...result, action });
  });

  await router.post("/remove-startup", async (req) => {
    const { filepath } = (await req.json()) as { filepath: string };
    if (!filepath)
      return Response.json(
        { success: false, error: "No filepath provided" },
        { status: 400 },
      );
    const result = await removeStartupItem(filepath);
    return Response.json(result);
  });

  await router.post("/dir-sizes", async (req) => {
    const { paths } = (await req.json()) as { paths: string[] };
    if (!paths || !Array.isArray(paths))
      return Response.json(
        { success: false, error: "No paths provided" },
        { status: 400 },
      );
    const results: Record<string, number> = {};
    await Promise.all(
      paths.map(async (p) => {
        const resolved = path.resolve(p);
        if (!resolved.startsWith(HOME)) return;
        try {
          results[p] = await getDirSize(resolved);
        } catch {
          results[p] = 0;
        }
      }),
    );
    return Response.json({ success: true, sizes: results });
  });

  await router.post("/empty-trash", async () => {
    const result = await emptyTrash();
    return Response.json({
      success: result.success,
      freedBytes: result.freedBytes,
    });
  });

  // ── Live process data ───────────────────────────────────────

  await router.post("/live-processes", async () => {
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

  await router.post("/brew-update", async (req) => {
    const { name, type } = (await req.json()) as {
      name: string;
      type: "formula" | "cask";
    };
    if (!name) return Response.json({ success: false, error: "No package name" }, { status: 400 });

    try {
      const cmd = type === "cask"
        ? `brew upgrade --cask ${name} 2>&1`
        : `brew upgrade ${name} 2>&1`;
      const proc = Bun.spawn(["bash", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        return Response.json({ success: false, error: output.trim().split("\n").pop() || "Upgrade failed" });
      }

      // Get the new version
      const verCmd = type === "cask"
        ? `brew info --cask --json=v2 ${name} 2>/dev/null`
        : `brew info --json=v2 ${name} 2>/dev/null`;
      const verProc = Bun.spawn(["bash", "-c", verCmd], { stdout: "pipe", stderr: "pipe" });
      const verOutput = await new Response(verProc.stdout).text();
      let version = "latest";
      try {
        const info = JSON.parse(verOutput);
        if (type === "cask") {
          version = info.casks?.[0]?.version?.split(",")?.[0] || "latest";
        } else {
          version = info.formulae?.[0]?.versions?.stable || "latest";
        }
      } catch {}

      return Response.json({ success: true, version });
    } catch (err: any) {
      return Response.json({ success: false, error: err.message || "Upgrade failed" });
    }
  });

  await router.post("/brew-update-all", async () => {
    try {
      const proc = Bun.spawn(["bash", "-c", "brew upgrade 2>&1"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      return Response.json({
        success: exitCode === 0,
        output: output.trim().split("\n").slice(-5).join("\n"),
        error: exitCode !== 0 ? "Some packages failed to update" : undefined,
      });
    } catch (err: any) {
      return Response.json({ success: false, error: err.message || "Upgrade failed" });
    }
  });

  // ── Pantry update endpoint ─────────────────────────────────

  await router.post("/pantry-update", async (req) => {
    const { name } = (await req.json()) as { name: string };
    if (!name)
      return Response.json({ success: false, error: "No package name" }, { status: 400 });

    try {
      const proc = Bun.spawn(["bash", "-c", `pantry update ${name} 2>&1`], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      return Response.json({
        success: exitCode === 0,
        output: output.trim().split("\n").slice(-3).join("\n"),
        error: exitCode !== 0 ? output.trim().split("\n").pop() || "Update failed" : undefined,
      });
    } catch (err: any) {
      return Response.json({ success: false, error: err.message || "Update failed" });
    }
  });

  // ── Desktop app update endpoint ──────────────────────────────

  await router.post("/app-update", async (req) => {
    const { name, caskToken } = (await req.json()) as {
      name: string;
      caskToken: string;
    };
    if (!caskToken)
      return Response.json({ success: false, error: "No cask token provided" }, { status: 400 });

    // Sanitize cask token to prevent command injection
    const safeCaskToken = caskToken.replace(/[^a-z0-9@._+-]/gi, "");
    if (!safeCaskToken || safeCaskToken !== caskToken)
      return Response.json({ success: false, error: "Invalid cask token" }, { status: 400 });

    try {
      // Try upgrade first (for brew-managed casks)
      let proc = Bun.spawn(
        ["bash", "-c", `brew upgrade --cask ${safeCaskToken} 2>&1`],
        { stdout: "pipe", stderr: "pipe" },
      );
      let output = await new Response(proc.stdout).text();
      let exitCode = await proc.exited;

      // If not installed via brew, try fresh install
      if (exitCode !== 0 && (output.includes("not installed") || output.includes("No available"))) {
        proc = Bun.spawn(
          ["bash", "-c", `brew install --cask ${safeCaskToken} 2>&1`],
          { stdout: "pipe", stderr: "pipe" },
        );
        output = await new Response(proc.stdout).text();
        exitCode = await proc.exited;
      }

      if (exitCode !== 0) {
        return Response.json({
          success: false,
          error: output.trim().split("\n").pop() || "Update failed",
        });
      }

      // Get new version
      const verProc = Bun.spawn(
        ["bash", "-c", `brew info --cask --json=v2 ${safeCaskToken} 2>/dev/null`],
        { stdout: "pipe", stderr: "pipe" },
      );
      const verOutput = await new Response(verProc.stdout).text();
      let version = "latest";
      try {
        const info = JSON.parse(verOutput);
        version = info.casks?.[0]?.version?.split(",")?.[0] || "latest";
      } catch {}

      return Response.json({ success: true, version });
    } catch (err: any) {
      return Response.json({ success: false, error: err.message || "Update failed" });
    }
  });

  // ── System apps with sizes ───────────────────────────────────

  await router.post("/system-apps", async () => {
    const apps: { name: string; sizeBytes: number }[] = [];
    try {
      const entries = fs.readdirSync("/Applications").filter((e: string) => e.endsWith(".app")).sort();
      const BATCH = 10;
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(async (entry: string) => {
            const name = entry.replace(/\.app$/, "");
            let sizeBytes = 0;
            try {
              sizeBytes = await getDirSize(path.resolve("/Applications", entry));
            } catch {}
            return { name, sizeBytes };
          }),
        );
        apps.push(...results);
      }
    } catch {}
    return Response.json({ success: true, apps });
  });

  // ── Updates check (brew, pantry, desktop apps) ───────────────

  await router.post("/updates-check", async () => {
    // App name → Homebrew cask token mapping
    const CASK_MAP: Record<string, string> = {
      "1Password": "1password", "1Password 7": "1password",
      "Alacritty": "alacritty", "Alfred": "alfred",
      "Android Studio": "android-studio", "AppCleaner": "appcleaner",
      "Arc": "arc", "Audacity": "audacity",
      "BBEdit": "bbedit", "Bartender": "bartender",
      "Bear": "bear", "BetterTouchTool": "bettertouchtool",
      "Brave Browser": "brave-browser",
      "CLion": "clion", "Caffeine": "caffeine",
      "ChatGPT": "chatgpt", "Claude": "claude",
      "CleanMyMac": "cleanmymac", "CleanMyMac X": "cleanmymac",
      "CleanShot X": "cleanshot", "CotEditor": "coteditor",
      "Cursor": "cursor", "Cyberduck": "cyberduck",
      "Dash": "dash", "DataGrip": "datagrip",
      "DaVinci Resolve": "davinci-resolve",
      "Discord": "discord", "Docker": "docker",
      "Dropbox": "dropbox", "Dynobase": "dynobase",
      "Fantastical": "fantastical", "Figma": "figma",
      "Firefox": "firefox", "Fork": "fork", "ForkLift": "forklift",
      "Ghostty": "ghostty", "GitHub Desktop": "github",
      "GitKraken": "gitkraken", "GoLand": "goland",
      "Google Chrome": "google-chrome", "Google Drive": "google-drive",
      "Grammarly Desktop": "grammarly-desktop",
      "HTTPie": "httpie", "HandBrake": "handbrake",
      "Hyper": "hyper",
      "IINA": "iina", "ImageOptim": "imageoptim",
      "IntelliJ IDEA": "intellij-idea", "Insomnia": "insomnia",
      "Joplin": "joplin",
      "Kap": "kap", "Karabiner-Elements": "karabiner-elements",
      "Keka": "keka", "Kitty": "kitty",
      "Linear": "linear-linear", "Logseq": "logseq",
      "Logi Options+": "logi-options-plus",
      "logioptionsplus": "logi-options-plus",
      "Logi Options Plus": "logi-options-plus",
      "Loom": "loom",
      "Maccy": "maccy", "MediaInfo": "mediainfo",
      "Microsoft Edge": "microsoft-edge",
      "Microsoft Teams": "microsoft-teams",
      "MonitorControl": "monitorcontrol", "Mullvad VPN": "mullvad-vpn",
      "Muzzle": "muzzle",
      "NordVPN": "nordvpn", "Notion": "notion", "Nova": "nova",
      "Numi": "numi",
      "OBS": "obs", "Obsidian": "obsidian",
      "OneDrive": "onedrive", "Opera": "opera",
      "OrbStack": "orbstack", "Orion": "orion",
      "Parallels Desktop": "parallels",
      "Pearcleaner": "pearcleaner", "PhpStorm": "phpstorm",
      "Plex": "plex", "Postman": "postman",
      "Proxyman": "proxyman", "PyCharm": "pycharm",
      "Raycast": "raycast", "Rectangle": "rectangle",
      "Rider": "rider", "RubyMine": "rubymine",
      "Sequel Ace": "sequel-ace",
      "Setapp": "setapp", "Shottr": "shottr",
      "Signal": "signal", "Sketch": "sketch",
      "Skype": "skype", "Slack": "slack",
      "SourceTree": "sourcetree", "Spotify": "spotify",
      "Steam": "steam", "Sublime Merge": "sublime-merge",
      "Sublime Text": "sublime-text",
      "TablePlus": "tableplus", "Tailscale": "tailscale",
      "Telegram": "telegram", "The Unarchiver": "the-unarchiver",
      "Things3": "things", "Things": "things",
      "TickTick": "ticktick", "Tinkerwell": "tinkerwell",
      "Todoist": "todoist", "Tower": "tower",
      "Transmit": "transmit", "Typora": "typora",
      "UTM": "utm",
      "VLC": "vlc", "VMware Fusion": "vmware-fusion",
      "Visual Studio Code": "visual-studio-code",
      "Vivaldi": "vivaldi",
      "Warp": "warp", "WebStorm": "webstorm",
      "WhatsApp": "whatsapp", "WireGuard": "wireguard-go",
      "Zed": "zed", "Zen Browser": "zen-browser",
      "Zoom": "zoom", "iTerm": "iterm2",
      "iStat Menus": "istat-menus",
    };

    const SYSTEM_APPS = new Set([
      "Safari", "Preview", "TextEdit", "Automator", "Font Book",
      "Migration Assistant", "Photo Booth", "System Preferences",
      "System Settings", "Disk Utility", "Terminal", "Activity Monitor",
      "Console", "Grapher", "Script Editor", "Time Machine", "Photos",
      "Mail", "Calendar", "Contacts", "Reminders", "Notes", "Maps",
      "Messages", "FaceTime", "Books", "News", "Stocks", "Weather",
      "Home", "Podcasts", "Music", "TV", "Voice Memos", "Freeform",
      "Shortcuts", "Chess", "Dictionary", "Stickies", "Image Capture",
      "Color Picker", "Simulator", "Simulator (Watch)",
    ]);

    const MAS_APPS = new Set([
      "Xcode", "Numbers", "Pages", "Keynote", "GarageBand", "iMovie",
      "Grammarly for Safari", "AdBlock", "HP Smart", "Audible",
      "CleanMyMac_5_MAS", "Mini Motorways", "Snake.io+",
      "Numbers Creator Studio", "Things3",
    ]);

    function isNewerVersion(latest: string, current: string): boolean {
      if (!latest || !current || latest === current) return false;
      if (current === "?") return !!latest;
      const norm = (v: string) => v.replace(/[,+].*/g, "").replace(/-.*$/, "").split(".").map(n => parseInt(n, 10) || 0);
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
      try { return fs.readdirSync("/Applications").filter((e: string) => e.endsWith(".app")); }
      catch { return []; }
    })();

    const [brewResult, pantryResult, pantryPkgs, rawApps] = await Promise.all([
      exec("brew outdated --json 2>/dev/null", { timeout: 30000 }),
      exec("pantry outdated 2>/dev/null", { timeout: 10000 }),
      (async () => {
        try {
          const globalDir = path.join(HOME, ".pantry/global/packages");
          return fs.existsSync(globalDir) ? fs.readdirSync(globalDir) : [];
        } catch { return [] as string[]; }
      })(),
      Promise.all(entries.map(async (app: string) => {
        const name = app.replace(/\.app$/, "");
        if (SYSTEM_APPS.has(name)) return null;
        let version = "?";
        try {
          const plistPath = `/Applications/${app}/Contents/Info.plist`;
          if (fs.existsSync(plistPath)) {
            const r = await exec(`/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "${plistPath}" 2>/dev/null`, { timeout: 2000 });
            if (r.ok && r.stdout) version = r.stdout;
          }
        } catch {}
        return { name, version };
      })).then(results => results.filter((r): r is { name: string; version: string } => r !== null)),
    ]);

    // Parse brew outdated
    const brewFormulae: { name: string; current: string; latest: string; pinned: boolean }[] = [];
    const brewCasks: { name: string; current: string; latest: string }[] = [];
    if (brewResult.ok && brewResult.stdout) {
      try {
        const data = JSON.parse(brewResult.stdout);
        for (const f of (data.formulae || [])) {
          brewFormulae.push({ name: f.name, current: (f.installed_versions || [])[0] || "?", latest: f.current_version || "?", pinned: f.pinned || false });
        }
        for (const c of (data.casks || [])) {
          brewCasks.push({ name: c.name, current: (c.installed_versions || [])[0]?.split(",")[0] || "?", latest: c.current_version?.split(",")[0] || "?" });
        }
      } catch {}
    }

    // Parse pantry outdated
    const pantryOutdated: { name: string; current: string; latest: string }[] = [];
    if (pantryResult.ok && pantryResult.stdout) {
      const lines = pantryResult.stdout.split("\n");
      let inTable = false;
      for (const line of lines) {
        if (line.startsWith("---")) { inTable = true; continue; }
        if (!inTable || !line.trim() || line.startsWith("Legend") || line.startsWith("Found")) continue;
        const parts = line.trim().split(/\s{2,}/);
        if (parts.length >= 4) {
          pantryOutdated.push({
            name: parts[0].replace(/\u001b\[\d+m/g, "").trim(),
            current: parts[1].replace(/"/g, "").trim(),
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
    const caskVersions: Record<string, { version: string; autoUpdates: boolean }> = {};
    if (tokensToQuery.length > 0) {
      const batchPromises: Promise<void>[] = [];
      for (let i = 0; i < tokensToQuery.length; i += 15) {
        const batch = tokensToQuery.slice(i, i + 15);
        batchPromises.push(
          exec(`brew info --cask --json=v2 ${batch.join(" ")} 2>/dev/null`, { timeout: 30000 })
            .then(r => {
              if (r.ok && r.stdout) {
                try {
                  const data = JSON.parse(r.stdout);
                  for (const cask of (data.casks || [])) {
                    caskVersions[cask.token] = {
                      version: (cask.version || "").split(",")[0],
                      autoUpdates: cask.auto_updates || false,
                    };
                  }
                } catch {}
              }
            }),
        );
      }
      await Promise.all(batchPromises);
    }

    // Build desktop apps list
    interface DesktopApp {
      name: string; version: string; latestVersion: string | null;
      updateAvailable: boolean; source: string; caskToken: string | null; autoUpdates: boolean;
    }
    const desktopApps: DesktopApp[] = [];
    const desktopOutdated: DesktopApp[] = [];

    for (const app of rawApps) {
      const isMAS = MAS_APPS.has(app.name);
      const token = CASK_MAP[app.name] || null;
      const caskInfo = token ? caskVersions[token] : null;

      let source = "unknown";
      let latestVersion: string | null = null;
      let updateAvailable = false;
      let autoUpdates = false;

      if (isMAS) {
        source = "mas";
      } else if (caskInfo) {
        latestVersion = caskInfo.version;
        autoUpdates = caskInfo.autoUpdates;
        updateAvailable = isNewerVersion(latestVersion, app.version);
        source = autoUpdates ? "auto" : "brew";
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
