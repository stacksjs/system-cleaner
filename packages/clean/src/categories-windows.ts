import type { CleanTarget } from './types'
import * as path from 'node:path'
import process from 'node:process'
import { buildWinPaths, HOME } from '@system-cleaner/core'
import { c, t } from './target-factory'

/**
 * What Quick Clean offers on Windows.
 *
 * A separate table rather than a translation of the macOS one. The two
 * platforms do not disagree about where a cache lives so much as about what a
 * cache *is*: Windows has no per-user Library, no saved application state and
 * no preference plists, and it has several things macOS does not — Windows
 * Error Reporting, the shader cache each GPU vendor keeps, the per-vendor
 * DirectX caches. Mapping concept to concept would have produced entries that
 * scan a directory which was never the thing they meant, and this app deletes
 * what it scans.
 *
 * **Every target here is user-scope**, under `%LOCALAPPDATA%`, `%APPDATA%` or
 * `%USERPROFILE%`. The admin-scope wins — `C:\Windows\Temp`, `Prefetch`,
 * `SoftwareDistribution\Download`, the component store — are deliberately
 * absent rather than present and marked. The agent has no way to elevate, so
 * listing them would mean a Clean button that can only ever fail, and this app
 * has a standing rule against offering an action that cannot work. They belong
 * to an elevated helper that does not exist yet.
 *
 * Paths come from the environment rather than assuming `C:\Users\<name>`: a
 * domain profile can live on any drive, and `%LOCALAPPDATA%` moves on a
 * machine with folder redirection turned on.
 *
 * See stacksjs/system-cleaner#23.
 */

/**
 * A Chromium profile's disposable directories.
 *
 * Every Chromium browser keeps the same five, and together they are the
 * largest reclaimable category on a browsing machine. Listed per browser
 * rather than globbed from `User Data\*` on purpose: `Default` and `Profile 1`
 * hold history, logins and extensions beside the caches, so a glob that
 * drifted one level up would take all of it.
 */
function chromium(idPrefix: string, label: string, userData: string): CleanTarget[] {
  const join = path.win32.join
  return [
    t(`${idPrefix}-cache`, `${label} Cache`, join(userData, 'Default', 'Cache'), 'browser', `${label} page and resource cache`, true),
    t(`${idPrefix}-code-cache`, `${label} Code Cache`, join(userData, 'Default', 'Code Cache'), 'browser', `${label} compiled script cache`, true),
    t(`${idPrefix}-gpu-cache`, `${label} GPU Cache`, join(userData, 'Default', 'GPUCache'), 'browser', `${label} GPU shader cache`, true),
    t(`${idPrefix}-sw-cache`, `${label} Service Workers`, join(userData, 'Default', 'Service Worker', 'CacheStorage'), 'browser', `${label} service worker cache`, true),
    t(`${idPrefix}-shader`, `${label} Shader Cache`, join(userData, 'ShaderCache'), 'browser', `${label} compiled shader cache`, true),
  ]
}

/**
 * Build the table from an environment.
 *
 * A function rather than a module-level array so a test can inject a real
 * Windows environment from any platform. Built from `process.env` on macOS
 * this table is a set of hybrid nonsense paths —
 * `/Users/glenn/AppData/Local\npm-cache` — which is harmless, because the
 * selector never picks it off Windows, and untestable, which is not.
 */
export function buildWindowsTargets(env: Record<string, string | undefined> = process.env): CleanTarget[] {
  const w = buildWinPaths(env)

  /**
   * The profile root, resolved the way `buildWinPaths` resolves it.
   *
   * `%USERPROFILE%` rather than `os.homedir()`, and not because they usually
   * differ: they usually do not. They differ on exactly the machines where it
   * matters — a roamed domain profile, a redirected home — and taking the two
   * bases from two different sources would put `%LOCALAPPDATA%` on one volume
   * and `~/.cargo` on another.
   */
  const userProfile = env.USERPROFILE || HOME

  /** `%LOCALAPPDATA%\...` */
  const local = (...parts: string[]): string => path.win32.join(w.localAppData, ...parts)
  /** `%APPDATA%\...` — the roaming half, which syncs on a domain profile. */
  const roaming = (...parts: string[]): string => path.win32.join(w.roamingAppData, ...parts)
  /** `%USERPROFILE%\...` — for the tools that keep a dotdir instead. */
  const home = (...parts: string[]): string => path.win32.join(userProfile, ...parts)

  return [
    // ═══════════════════════════════════════════════════════════════
    // TEMP AND CACHES
    // ═══════════════════════════════════════════════════════════════
    // Contents only, always. %TEMP% itself going missing breaks installers
    // and half the toolchains on the machine.
    t('user-temp', 'Temporary Files', w.temp, 'cache', 'Your user temp directory, which nothing clears automatically', true),
    t('inet-cache', 'Internet Cache', local('Microsoft', 'Windows', 'INetCache'), 'cache', 'Legacy WinINET cache, still used by many desktop apps', true),
    t('webcache', 'Web Platform Cache', local('Microsoft', 'Windows', 'WebCache'), 'cache', 'WinINET index and container cache', true),
    t('explorer-thumbs', 'Thumbnail Cache', local('Microsoft', 'Windows', 'Explorer'), 'cache', 'Explorer thumbnail and icon database; Explorer rebuilds it', true),
    t('font-cache-win', 'Font Cache', local('FontCache'), 'cache', 'Font rasterization cache', true),
    t('d3d-shader-cache', 'DirectX Shader Cache', local('D3DSCache'), 'cache', 'Compiled DirectX shaders; games rebuild them on first run', true),
    t('nvidia-dx-cache', 'NVIDIA DX Cache', local('NVIDIA', 'DXCache'), 'cache', 'NVIDIA DirectX shader cache', true),
    t('nvidia-gl-cache', 'NVIDIA GL Cache', local('NVIDIA', 'GLCache'), 'cache', 'NVIDIA OpenGL shader cache', true),
    t('amd-dx-cache', 'AMD Shader Cache', local('AMD', 'DxCache'), 'cache', 'AMD DirectX shader cache', true),
    t('intel-shader-cache', 'Intel Shader Cache', local('Intel', 'ShaderCache'), 'cache', 'Intel graphics shader cache', true),

    // ═══════════════════════════════════════════════════════════════
    // LOGS AND CRASH REPORTS
    // ═══════════════════════════════════════════════════════════════
    t('crash-dumps', 'Crash Dumps', w.crashReports, 'log', 'User-mode crash dumps, which run to hundreds of megabytes each', true),
    t('wer-reports', 'Error Reports', local('Microsoft', 'Windows', 'WER', 'ReportArchive'), 'log', 'Archived Windows Error Reporting reports', true),
    t('wer-queue', 'Error Report Queue', local('Microsoft', 'Windows', 'WER', 'ReportQueue'), 'log', 'Error reports queued for submission', true),

    // ═══════════════════════════════════════════════════════════════
    // BROWSERS
    // ═══════════════════════════════════════════════════════════════
    ...chromium('chrome', 'Chrome', local('Google', 'Chrome', 'User Data')),
    ...chromium('edge', 'Edge', local('Microsoft', 'Edge', 'User Data')),
    ...chromium('brave', 'Brave', local('BraveSoftware', 'Brave-Browser', 'User Data')),
    ...chromium('vivaldi', 'Vivaldi', local('Vivaldi', 'User Data')),
    ...chromium('opera', 'Opera', roaming('Opera Software', 'Opera Stable')),
    ...chromium('chromium', 'Chromium', local('Chromium', 'User Data')),
    // Firefox keeps its cache outside the profile directory, which is the
    // whole reason it gets an entry of its own rather than a chromium() call.
    t('firefox-cache', 'Firefox Cache', local('Mozilla', 'Firefox', 'Profiles'), 'browser', 'Firefox cache2 and startup cache', true),

    // ═══════════════════════════════════════════════════════════════
    // DEVELOPER — package managers
    // ═══════════════════════════════════════════════════════════════
    t('npm-cache', 'npm Cache', local('npm-cache'), 'developer', 'npm package cache; a reinstall refetches it', true),
    t('yarn-cache', 'Yarn Cache', local('Yarn', 'Cache'), 'developer', 'Yarn package cache', true),
    t('pnpm-store', 'pnpm Store', local('pnpm', 'store'), 'developer', 'pnpm content-addressable store', true),
    t('bun-cache', 'Bun Install Cache', home('.bun', 'install', 'cache'), 'developer', 'Bun package cache', true),
    t('deno-cache', 'Deno Cache', local('deno'), 'developer', 'Deno module and compilation cache', true),
    t('pip-cache', 'pip Cache', local('pip', 'Cache'), 'developer', 'Python wheel and HTTP cache', true),
    t('nuget-cache', 'NuGet Packages', home('.nuget', 'packages'), 'developer', 'NuGet global package folder', true),
    t('nuget-http-cache', 'NuGet HTTP Cache', local('NuGet', 'v3-cache'), 'developer', '.NET package HTTP cache', true),
    t('cargo-registry', 'Cargo Registry', home('.cargo', 'registry'), 'developer', 'Rust crate sources and registry index', true),
    t('gradle-cache', 'Gradle Cache', home('.gradle', 'caches'), 'developer', 'Gradle build and dependency cache', true),
    t('maven-repo', 'Maven Repository', home('.m2', 'repository'), 'developer', 'Maven local repository', true),
    t('composer-cache', 'Composer Cache', local('Composer'), 'developer', 'PHP Composer package cache', true),
    t('go-build-cache', 'Go Build Cache', local('go-build'), 'developer', 'Go compiler build cache', true),
    t('go-mod-cache', 'Go Module Cache', home('go', 'pkg', 'mod'), 'developer', 'Go module download cache', true),

    // ═══════════════════════════════════════════════════════════════
    // DEVELOPER — editors and toolchains
    // ═══════════════════════════════════════════════════════════════
    t('vscode-cache', 'VS Code Cache', roaming('Code', 'Cache'), 'developer', 'VS Code network cache', true),
    t('vscode-cached-data', 'VS Code Cached Data', roaming('Code', 'CachedData'), 'developer', 'VS Code compiled script cache, regenerated per version', true),
    t('vscode-crash', 'VS Code Crash Reports', roaming('Code', 'Crashpad'), 'developer', 'VS Code crash dumps', true),
    t('vs-component-cache', 'Visual Studio Caches', local('Microsoft', 'VisualStudio'), 'developer', 'Visual Studio MEF component and design-time caches', true),
    t('jetbrains-caches', 'JetBrains Caches', local('JetBrains'), 'developer', 'IntelliJ, WebStorm and Rider index caches', true),
    t('docker-logs', 'Docker Desktop Logs', local('Docker', 'log'), 'developer', 'Docker Desktop logs', true),
    t('electron-builder', 'electron-builder Cache', local('electron-builder', 'Cache'), 'developer', 'Downloaded Electron and app-builder binaries', true),
    t('electron-cache', 'Electron Cache', local('electron', 'Cache'), 'developer', 'Electron release downloads', true),
    t('puppeteer-cache', 'Puppeteer Browsers', home('.cache', 'puppeteer'), 'developer', 'Chromium builds downloaded by Puppeteer', true),
    t('playwright-cache', 'Playwright Browsers', local('ms-playwright'), 'developer', 'Browser builds downloaded by Playwright', true),

    // ═══════════════════════════════════════════════════════════════
    // APPLICATIONS
    // ═══════════════════════════════════════════════════════════════
    t('teams-cache', 'Teams Cache', roaming('Microsoft', 'Teams', 'Cache'), 'application', 'Microsoft Teams cache', true),
    t('slack-cache', 'Slack Cache', roaming('Slack', 'Cache'), 'application', 'Slack cache', true),
    t('discord-cache', 'Discord Cache', roaming('discord', 'Cache'), 'application', 'Discord cache', true),
    t('spotify-cache', 'Spotify Cache', local('Spotify', 'Storage'), 'application', 'Spotify offline storage cache', true),
    t('steam-htmlcache', 'Steam Web Cache', local('Steam', 'htmlcache'), 'application', 'Steam client web cache', true),
    t('zoom-cache', 'Zoom Cache', roaming('Zoom', 'data'), 'application', 'Zoom cached data', true),
    t('onedrive-logs', 'OneDrive Logs', local('Microsoft', 'OneDrive', 'logs'), 'log', 'OneDrive sync logs', true),

    // ═══════════════════════════════════════════════════════════════
    // AI TOOLING — stores nothing rebuilds, so every one is `caution`
    // ═══════════════════════════════════════════════════════════════
    // Not caches. A model is a multi-gigabyte download and a session
    // transcript is the only copy of a conversation, so these stay out of
    // "Select All Safe" and carry a label. Same ids as the macOS table: these
    // tools are cross-platform, and the UI copy, the tests and the schedule
    // specs all key off the id.
    c('claude-code-projects', 'Claude Code Projects', home('.claude', 'projects'), 'developer', 'Claude Code session transcripts — the only copy of each conversation'),
    c('codex-sessions', 'Codex Sessions', home('.codex', 'sessions'), 'developer', 'Codex session transcripts'),
    c('codex-archived-sessions', 'Codex Archived Sessions', home('.codex', 'archived_sessions'), 'developer', 'Archived Codex session transcripts'),
    c('ollama-models', 'Ollama Models', home('.ollama', 'models'), 'developer', 'Downloaded Ollama models, several gigabytes each'),
    c('lmstudio-models', 'LM Studio Models', home('.cache', 'lm-studio', 'models'), 'developer', 'Downloaded LM Studio models'),
    c('vagrant-boxes', 'Vagrant Boxes', home('.vagrant.d', 'boxes'), 'developer', 'Downloaded Vagrant base boxes'),
  ]
}

/** The table for this machine's environment. */
export const WINDOWS_TARGETS: CleanTarget[] = buildWindowsTargets()
