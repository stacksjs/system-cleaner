import { HOME, macPaths } from '@system-cleaner/core'
import * as path from 'node:path'
import type { CleanTarget } from './types'

/**
 * One Framework7 glyph per category.
 *
 * Targets used to carry a per-entry emoji, which put 61 different multi-color
 * glyphs into a list the rest of the app renders as single-tint icons. The row
 * already names the target and its category, so the icon only has to say which
 * kind of thing this is.
 *
 * Declared above CLEAN_TARGETS on purpose: the array literal calls `t()` during
 * module evaluation, so a later `const` would still be in its temporal dead
 * zone by the time the first target is built.
 */
const CATEGORY_ICONS: Record<CleanTarget['category'], string> = {
  cache: 'i-f7-archivebox-fill',
  log: 'i-f7-doc-text-fill',
  browser: 'i-f7-globe',
  developer: 'i-f7-chevron-left-slash-chevron-right',
  homebrew: 'i-f7-cube-box-fill',
  application: 'i-f7-app-fill',
  system: 'i-f7-desktopcomputer',
  trash: 'i-f7-trash-fill',
  // Emitted by the disk analyzer for build output it finds inside projects.
  'project-artifact': 'i-f7-hammer-fill',
}

/** Iconify class for a clean-target category. */
export function iconForCategory(category: CleanTarget['category']): string {
  return CATEGORY_ICONS[category] ?? 'i-f7-archivebox-fill'
}

/**
 * Comprehensive cleaning database — 260+ targets, organized by category.
 *
 * Entries earn their place by being found on a real machine, not by being
 * plausible. The AI-tooling, browser-automation and second-location caches
 * below came from auditing a working developer Mac where the previous list
 * surfaced 32 targets and walked past roughly 30 GB it had no entry for.
 */
export const CLEAN_TARGETS: CleanTarget[] = [
  // ═══════════════════════════════════════════════════════════════
  // USER CACHES
  // ═══════════════════════════════════════════════════════════════
  t('user-caches', 'User Caches', `${HOME}/Library/Caches`, 'cache', 'Application caches (safe to remove, apps rebuild them)', true),
  t('font-cache', 'Font Caches', `${HOME}/Library/Caches/com.apple.FontRegistry`, 'cache', 'System font registry cache', true),
  t('quicklook-cache', 'QuickLook Thumbnails', `${HOME}/Library/Caches/com.apple.QuickLook.thumbnailcache`, 'cache', 'Finder thumbnail preview cache', true),
  t('icon-services', 'Icon Services Cache', `${HOME}/Library/Caches/com.apple.iconservices.store`, 'cache', 'Application icon cache', false),

  // ═══════════════════════════════════════════════════════════════
  // LOGS & CRASH REPORTS
  // ═══════════════════════════════════════════════════════════════
  t('user-logs', 'Application Logs', macPaths.logs, 'log', 'Application and system log files', true),
  t('crash-reports', 'Crash Reports', macPaths.crashReports, 'log', 'Application crash diagnostic reports', true),
  t('system-crash-reports', 'System Crash Reports', macPaths.systemCrashReports, 'log', 'System-level crash reports', true, true),
  t('system-logs', 'System Logs', '/private/var/log', 'log', 'System daemon and service logs', true, true),
  t('adobe-logs', 'Adobe Logs', '/Library/Logs/Adobe', 'log', 'Adobe Creative Cloud logs', true, true),
  t('adobe-gc-log', 'Adobe GC Log', '/Library/Logs/adobegc.log', 'log', 'Adobe garbage collection log', false, true),

  // ═══════════════════════════════════════════════════════════════
  // BROWSERS — cache, service workers, GPU cache
  // ═══════════════════════════════════════════════════════════════
  // Chrome
  t('chrome-cache', 'Chrome Cache', `${HOME}/Library/Caches/Google/Chrome`, 'browser', 'Google Chrome browser cache', true),
  t('chrome-sw', 'Chrome Service Workers', `${HOME}/Library/Application Support/Google/Chrome/Default/Service Worker/CacheStorage`, 'browser', 'Chrome service worker cache', true),
  t('chrome-gpu', 'Chrome GPU Cache', `${HOME}/Library/Application Support/Google/Chrome/Default/GPUCache`, 'browser', 'Chrome GPU shader cache', true),
  t('chrome-code', 'Chrome Code Cache', `${HOME}/Library/Application Support/Google/Chrome/Default/Code Cache`, 'browser', 'Chrome compiled code cache', true),
  // Safari
  t('safari-cache', 'Safari Cache', `${HOME}/Library/Caches/com.apple.Safari`, 'browser', 'Safari browser cache', true),
  t('safari-webkit', 'Safari WebKit Cache', `${HOME}/Library/Caches/com.apple.WebKit.WebContent`, 'browser', 'Safari WebKit rendering cache', true),
  t('safari-webkit-net', 'Safari Networking Cache', `${HOME}/Library/Caches/com.apple.WebKit.Networking`, 'browser', 'Safari WebKit networking cache', true),
  t('safari-safebrowsing', 'Safari Safe Browsing', `${HOME}/Library/Caches/com.apple.Safari.SafeBrowsing`, 'browser', 'Safari safe browsing data', true),
  // Firefox
  t('firefox-cache', 'Firefox Cache', `${HOME}/Library/Caches/Firefox`, 'browser', 'Mozilla Firefox browser cache', true),
  // Edge
  t('edge-cache', 'Edge Cache', `${HOME}/Library/Caches/Microsoft Edge`, 'browser', 'Microsoft Edge browser cache', true),
  // Brave
  t('brave-cache', 'Brave Cache', `${HOME}/Library/Caches/BraveSoftware/Brave-Browser`, 'browser', 'Brave browser cache', true),
  // Edge — the same four stores Chrome gets above
  t('edge-sw', 'Edge Service Workers', `${HOME}/Library/Application Support/Microsoft Edge/Default/Service Worker/CacheStorage`, 'browser', 'Edge service worker cache', true),
  t('edge-gpu', 'Edge GPU Cache', `${HOME}/Library/Application Support/Microsoft Edge/Default/GPUCache`, 'browser', 'Edge GPU shader cache', true),
  t('edge-code', 'Edge Code Cache', `${HOME}/Library/Application Support/Microsoft Edge/Default/Code Cache`, 'browser', 'Edge compiled code cache', true),
  // Brave
  t('brave-sw', 'Brave Service Workers', `${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/Default/Service Worker/CacheStorage`, 'browser', 'Brave service worker cache', true),
  t('brave-gpu', 'Brave GPU Cache', `${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/Default/GPUCache`, 'browser', 'Brave GPU shader cache', true),
  t('brave-code', 'Brave Code Cache', `${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/Default/Code Cache`, 'browser', 'Brave compiled code cache', true),
  // Arc
  t('arc-cache', 'Arc Cache', `${HOME}/Library/Caches/company.thebrowser.Browser`, 'browser', 'Arc browser cache', true),
  t('arc-sw', 'Arc Service Workers', `${HOME}/Library/Application Support/Arc/User Data/Default/Service Worker/CacheStorage`, 'browser', 'Arc service worker cache', true),
  t('arc-gpu', 'Arc GPU Cache', `${HOME}/Library/Application Support/Arc/User Data/Default/GPUCache`, 'browser', 'Arc GPU shader cache', true),
  t('arc-code', 'Arc Code Cache', `${HOME}/Library/Application Support/Arc/User Data/Default/Code Cache`, 'browser', 'Arc compiled code cache', true),
  // Dia — two bundle ids, and both carry weight
  t('dia-cache', 'Dia Cache', `${HOME}/Library/Caches/Dia`, 'browser', 'Dia browser cache', true),
  t('dia-browser-cache', 'Dia App Cache', `${HOME}/Library/Caches/company.thebrowser.dia`, 'browser', 'Dia application cache', true),
  t('dia-sw', 'Dia Service Workers', `${HOME}/Library/Application Support/Dia/User Data/Default/Service Worker/CacheStorage`, 'browser', 'Dia service worker cache', true),
  t('dia-gpu', 'Dia GPU Cache', `${HOME}/Library/Application Support/Dia/User Data/Default/GPUCache`, 'browser', 'Dia GPU shader cache', true),
  t('dia-code', 'Dia Code Cache', `${HOME}/Library/Application Support/Dia/User Data/Default/Code Cache`, 'browser', 'Dia compiled code cache', true),
  // Opera
  t('opera-cache', 'Opera Cache', `${HOME}/Library/Caches/com.operasoftware.Opera`, 'browser', 'Opera browser cache', true),
  // Vivaldi, Chromium, Zen, Orion, Safari Technology Preview
  t('vivaldi-cache', 'Vivaldi Cache', `${HOME}/Library/Caches/com.vivaldi.Vivaldi`, 'browser', 'Vivaldi browser cache', true),
  t('chromium-cache', 'Chromium Cache', `${HOME}/Library/Caches/org.chromium.Chromium`, 'browser', 'Chromium browser cache', true),
  t('zen-cache', 'Zen Browser Cache', `${HOME}/Library/Caches/app.zen-browser.zen`, 'browser', 'Zen browser cache', true),
  t('orion-cache', 'Orion Cache', `${HOME}/Library/Caches/com.kagi.kagimacOS`, 'browser', 'Orion browser cache', true),
  t('safari-tp-cache', 'Safari Technology Preview Cache', `${HOME}/Library/Caches/com.apple.SafariTechnologyPreview`, 'browser', 'Safari Technology Preview cache', true),
  // Headless and test builds Chrome leaves behind, plus the updater's old versions
  t('chrome-headless', 'Chrome Headless Profile', `${HOME}/Library/Application Support/Google/Chrome-headless`, 'browser', 'Profile data left by headless Chrome runs', true),
  t('chrome-for-testing', 'Chrome for Testing', `${HOME}/Library/Application Support/Google/Chrome for Testing`, 'browser', 'Profile data from Chrome for Testing builds', true),
  t('google-updater', 'Google Updater Versions', `${HOME}/Library/Application Support/Google/GoogleUpdater`, 'browser', 'Superseded copies of the Google updater', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — JavaScript ecosystem
  // ═══════════════════════════════════════════════════════════════
  t('npm-cache', 'npm Cache', `${HOME}/.npm`, 'developer', 'npm package manager cache', true),
  t('yarn-cache', 'Yarn Cache', `${HOME}/Library/Caches/Yarn`, 'developer', 'Yarn package manager cache', true),
  t('pnpm-store', 'pnpm Store', `${HOME}/Library/pnpm/store`, 'developer', 'pnpm content-addressable store', true),
  t('bun-cache', 'Bun Cache', `${HOME}/.bun/install/cache`, 'developer', 'Bun package manager cache', true),
  t('deno-cache', 'Deno Cache', `${HOME}/Library/Caches/deno`, 'developer', 'Deno module and build cache', true),
  t('turbo-cache', 'Turbo Cache', `${HOME}/.turbo/cache`, 'developer', 'Turborepo build cache', true),
  t('vite-cache', 'Vite Cache', `${HOME}/.cache/vite`, 'developer', 'Vite bundler cache', true),
  t('webpack-cache', 'Webpack Cache', `${HOME}/.cache/webpack`, 'developer', 'Webpack bundler cache', true),
  t('parcel-cache', 'Parcel Cache', `${HOME}/.parcel-cache`, 'developer', 'Parcel bundler cache', true),
  t('eslint-cache', 'ESLint Cache', `${HOME}/.cache/eslint`, 'developer', 'ESLint linter cache', true),
  t('prettier-cache', 'Prettier Cache', `${HOME}/.cache/prettier`, 'developer', 'Prettier formatter cache', true),
  t('typescript-cache', 'TypeScript Cache', `${HOME}/.cache/typescript`, 'developer', 'TypeScript compiler cache', true),
  t('electron-cache', 'Electron Cache', `${HOME}/.cache/electron`, 'developer', 'Electron framework cache', true),
  t('node-gyp-cache', 'node-gyp Cache', `${HOME}/.cache/node-gyp`, 'developer', 'node-gyp build cache', true),
  t('node-gyp-home', 'node-gyp Home', `${HOME}/.node-gyp`, 'developer', 'node-gyp headers cache', true),
  // node-gyp, bun and pnpm each write to a second location under Library that
  // the XDG-style entries above never matched.
  t('node-gyp-library', 'node-gyp Headers (Library)', `${HOME}/Library/Caches/node-gyp`, 'developer', 'Downloaded Node headers for native builds', true),
  t('bun-build-cache', 'Bun Build Cache', `${HOME}/.bun/build-cache`, 'developer', 'Bun compiled build artifacts and downloaded toolchains', true),
  t('bun-library-cache', 'Bun Cache (Library)', `${HOME}/Library/Caches/bun`, 'developer', 'Bun runtime cache', true),
  t('pnpm-library-cache', 'pnpm Cache', `${HOME}/Library/Caches/pnpm`, 'developer', 'pnpm metadata and download cache', true),
  t('yarn-berry-cache', 'Yarn Berry Cache', `${HOME}/.yarn/berry/cache`, 'developer', 'Yarn 2+ zipped package cache', true),
  t('yarn-xdg-cache', 'Yarn Cache (XDG)', `${HOME}/.cache/yarn`, 'developer', 'Yarn cache written under ~/.cache', true),
  t('corepack-cache', 'Corepack Cache', `${HOME}/Library/Caches/node/corepack`, 'developer', 'Corepack-managed package manager downloads', true),
  t('nvm-cache', 'nvm Cache', `${HOME}/.nvm/.cache`, 'developer', 'nvm Node download cache', true),
  t('volta-tmp', 'Volta Temp', `${HOME}/.volta/tmp`, 'developer', 'Volta staging directory', true),
  t('nx-cache', 'Nx Cache', `${HOME}/.cache/nx`, 'developer', 'Nx computation cache', true),
  t('bazel-cache', 'Bazel Cache', `${HOME}/.cache/bazel`, 'developer', 'Bazel build output cache', true),
  t('pre-commit-cache', 'pre-commit Cache', `${HOME}/.cache/pre-commit`, 'developer', 'pre-commit hook environments', true),
  t('gh-cache', 'GitHub CLI Cache', `${HOME}/.cache/gh`, 'developer', 'GitHub CLI API response cache', true),
  // Browser automation downloads whole browsers — hundreds of megabytes that
  // never appeared anywhere in this list before.
  t('puppeteer-cache', 'Puppeteer Browsers', `${HOME}/.cache/puppeteer`, 'developer', 'Chrome builds Puppeteer downloaded, re-fetched on next run', true),
  t('playwright-cache', 'Playwright Browsers', `${HOME}/Library/Caches/ms-playwright`, 'developer', 'Browser builds Playwright downloaded, restored by `playwright install`', true),
  t('playwright-xdg-cache', 'Playwright Browsers (XDG)', `${HOME}/.cache/ms-playwright`, 'developer', 'Playwright browsers written under ~/.cache', true),
  t('cypress-cache', 'Cypress Cache', `${HOME}/Library/Caches/Cypress`, 'developer', 'Cypress binary versions', true),
  t('selenium-cache', 'Selenium Cache', `${HOME}/.cache/selenium`, 'developer', 'Selenium driver downloads', true),
  // Launchpad / pantry package caches
  t('pantry-cache', 'Pantry Cache', `${HOME}/.cache/pantry`, 'developer', 'Downloaded pantry package archives', true),
  t('pantry-local-cache', 'Pantry Local Cache', `${HOME}/.pantry/cache`, 'developer', 'Pantry working cache', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — Xcode & Apple
  // ═══════════════════════════════════════════════════════════════
  t('xcode-deriveddata', 'Xcode DerivedData', `${HOME}/Library/Developer/Xcode/DerivedData`, 'developer', 'Xcode build artifacts and indexes', true),
  t('xcode-archives', 'Xcode Archives', `${HOME}/Library/Developer/Xcode/Archives`, 'developer', 'Xcode build archives', true),
  t('xcode-simulators', 'iOS Simulators', `${HOME}/Library/Developer/CoreSimulator/Devices`, 'developer', 'iOS simulator runtime data', true),
  t('xcode-caches', 'Xcode Caches', `${HOME}/Library/Caches/com.apple.dt.Xcode`, 'developer', 'Xcode IDE caches', true),
  t('xcode-device-logs', 'Xcode Device Logs', `${HOME}/Library/Developer/Xcode/iOS Device Logs`, 'developer', 'iOS device logs', true),
  t('xcode-watch-logs', 'Xcode watchOS Logs', `${HOME}/Library/Developer/Xcode/watchOS Device Logs`, 'developer', 'watchOS device logs', true),
  t('xcode-doc-cache', 'Xcode Documentation', `${HOME}/Library/Developer/Xcode/DocumentationCache`, 'developer', 'Xcode documentation cache', true),
  t('xcode-products', 'Xcode Products', `${HOME}/Library/Developer/Xcode/Products`, 'developer', 'Xcode build products', true),
  t('simulator-caches', 'Simulator Caches', `${HOME}/Library/Developer/CoreSimulator/Caches`, 'developer', 'CoreSimulator cache', true),
  t('simulator-logs', 'Simulator Logs', `${HOME}/Library/Logs/CoreSimulator`, 'developer', 'CoreSimulator logs', true),
  t('xcode-ios-devicesupport', 'iOS Device Support', `${HOME}/Library/Developer/Xcode/iOS DeviceSupport`, 'developer', 'Symbols per iOS version, re-copied when a device is next attached', true),
  t('xcode-watchos-devicesupport', 'watchOS Device Support', `${HOME}/Library/Developer/Xcode/watchOS DeviceSupport`, 'developer', 'Symbols per watchOS version, re-copied on next attach', true),
  t('xcode-instruments-cache', 'Instruments Cache', `${HOME}/Library/Caches/com.apple.dt.instruments`, 'developer', 'Instruments trace cache', true),
  t('cocoapods-cache', 'CocoaPods Cache', `${HOME}/Library/Caches/CocoaPods`, 'developer', 'CocoaPods dependency cache', true),
  t('swiftpm-cache', 'Swift Package Manager Cache', `${HOME}/Library/Caches/org.swift.swiftpm`, 'developer', 'Swift Package Manager dependency cache', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — Python ecosystem
  // ═══════════════════════════════════════════════════════════════
  t('pip-cache', 'pip Cache', `${HOME}/Library/Caches/pip`, 'developer', 'Python pip package cache', true),
  t('pyenv-cache', 'pyenv Cache', `${HOME}/.pyenv/cache`, 'developer', 'pyenv version cache', true),
  t('poetry-cache', 'Poetry Cache', `${HOME}/.cache/poetry`, 'developer', 'Poetry dependency cache', true),
  t('uv-cache', 'uv Cache', `${HOME}/.cache/uv`, 'developer', 'uv package manager cache', true),
  t('ruff-cache', 'Ruff Cache', `${HOME}/.cache/ruff`, 'developer', 'Ruff linter cache', true),
  t('mypy-cache', 'MyPy Cache', `${HOME}/.cache/mypy`, 'developer', 'MyPy type checker cache', true),
  t('pytest-cache', 'Pytest Cache', `${HOME}/.pytest_cache`, 'developer', 'Pytest test runner cache', true),
  t('jupyter-runtime', 'Jupyter Runtime', `${HOME}/.jupyter/runtime`, 'developer', 'Jupyter notebook runtime cache', true),
  t('huggingface-cache', 'Hugging Face Cache', `${HOME}/.cache/huggingface`, 'developer', 'Hugging Face model cache (can be very large)', true),
  t('torch-cache', 'PyTorch Cache', `${HOME}/.cache/torch`, 'developer', 'PyTorch model and hub cache', true),
  t('tensorflow-cache', 'TensorFlow Cache', `${HOME}/.cache/tensorflow`, 'developer', 'TensorFlow model cache', true),
  t('conda-cache', 'Conda Cache', `${HOME}/.conda/pkgs`, 'developer', 'Conda package cache', true),
  t('wandb-cache', 'Weights & Biases', `${HOME}/.cache/wandb`, 'developer', 'Weights & Biases experiment cache', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — Go, Rust, Zig, Java
  // ═══════════════════════════════════════════════════════════════
  t('go-modcache', 'Go Module Cache', `${HOME}/go/pkg/mod`, 'developer', 'Go module download cache', true),
  t('go-buildcache', 'Go Build Cache', `${HOME}/Library/Caches/go-build`, 'developer', 'Go compiler build cache', true),
  t('cargo-registry', 'Cargo Registry', `${HOME}/.cargo/registry/cache`, 'developer', 'Rust cargo package registry cache', true),
  t('cargo-registry-src', 'Cargo Crate Sources', `${HOME}/.cargo/registry/src`, 'developer', 'Unpacked crate sources (re-extracted from the registry cache)', true),
  t('cargo-git', 'Cargo Git Cache', `${HOME}/.cargo/git`, 'developer', 'Cargo git dependency cache', true),
  t('rustup-downloads', 'Rustup Downloads', `${HOME}/.rustup/downloads`, 'developer', 'Rust toolchain download cache', true),
  t('sccache', 'sccache', `${HOME}/Library/Caches/Mozilla.sccache`, 'developer', 'Shared compilation cache for Rust and C/C++', true),
  // Zig keeps a global cache next to the local `.zig-cache` each project owns.
  // The XDG path is used by zig itself, the Library path by Homebrew builds.
  t('zig-global-cache', 'Zig Global Cache', `${HOME}/.cache/zig`, 'developer', 'Zig global build cache (rebuilt on next `zig build`)', true),
  t('zig-library-cache', 'Zig Cache (Library)', `${HOME}/Library/Caches/zig`, 'developer', 'Zig cache written under Library/Caches', true),
  t('zls-cache', 'ZLS Cache', `${HOME}/.cache/zls`, 'developer', 'Zig Language Server build cache', true),
  t('gradle-cache', 'Gradle Cache', `${HOME}/.gradle/caches`, 'developer', 'Gradle build system cache', true),
  t('maven-cache', 'Maven Repository', `${HOME}/.m2/repository`, 'developer', 'Maven local repository cache', true),
  t('cargo-registry-index', 'Cargo Registry Index', `${HOME}/.cargo/registry/index`, 'developer', 'Crates.io index checkout, re-fetched on next build', true),
  t('rustup-tmp', 'Rustup Temp', `${HOME}/.rustup/tmp`, 'developer', 'Rustup staging directory', true),
  t('ccache', 'ccache', `${HOME}/.ccache`, 'developer', 'C/C++ compiler cache', true),
  t('ccache-library', 'ccache (Library)', `${HOME}/Library/Caches/ccache`, 'developer', 'ccache written under Library/Caches', true),
  t('coursier-cache', 'Coursier Cache', `${HOME}/Library/Caches/Coursier`, 'developer', 'Scala/JVM dependency cache', true),
  t('ivy-cache', 'Ivy Cache', `${HOME}/.ivy2/cache`, 'developer', 'Apache Ivy dependency cache', true),
  t('cabal-packages', 'Cabal Packages', `${HOME}/.cabal/packages`, 'developer', 'Haskell Cabal package downloads', true),
  t('nuget-cache', 'NuGet Packages', `${HOME}/.nuget/packages`, 'developer', '.NET NuGet global package cache', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — Docker, Cloud, DevOps
  // ═══════════════════════════════════════════════════════════════
  t('docker-data', 'Docker Data', `${HOME}/Library/Containers/com.docker.docker`, 'developer', 'Docker images, volumes, and build cache', true),
  t('docker-buildx', 'Docker BuildX Cache', `${HOME}/.docker/buildx/cache`, 'developer', 'Docker BuildX build cache', true),
  t('kubectl-cache', 'Kubernetes Cache', `${HOME}/.kube/cache`, 'developer', 'Kubernetes client cache', true),
  t('aws-cli-cache', 'AWS CLI Cache', `${HOME}/.aws/cli/cache`, 'developer', 'AWS CLI request cache', true),
  t('gcloud-logs', 'Google Cloud Logs', `${HOME}/.config/gcloud/logs`, 'developer', 'Google Cloud CLI logs', true),
  t('azure-logs', 'Azure CLI Logs', `${HOME}/.azure/logs`, 'developer', 'Azure CLI logs', true),
  t('docker-logs', 'Docker Logs', `${HOME}/Library/Containers/com.docker.docker/Data/log`, 'developer', 'Docker Desktop daemon logs', true),
  t('docker-scout', 'Docker Scout Cache', `${HOME}/.docker/scout`, 'developer', 'Docker Scout analysis cache', true),
  t('orbstack-logs', 'OrbStack Logs', `${HOME}/.orbstack/log`, 'developer', 'OrbStack machine logs', true),
  t('terraform-plugin-cache', 'Terraform Plugin Cache', `${HOME}/.terraform.d/plugin-cache`, 'developer', 'Terraform provider plugin downloads', true),
  c('vagrant-boxes', 'Vagrant Boxes', `${HOME}/.vagrant.d/boxes`, 'developer', 'Downloaded Vagrant box images — each has to be pulled again', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — Ruby, PHP, Dart/Flutter, Misc
  // ═══════════════════════════════════════════════════════════════
  t('gem-cache', 'RubyGems Cache', `${HOME}/.gem`, 'developer', 'Ruby gems package cache', true),
  t('composer-cache', 'Composer Cache', `${HOME}/Library/Caches/composer`, 'developer', 'PHP Composer package cache', true),
  t('flutter-cache', 'Flutter Cache', `${HOME}/.pub-cache`, 'developer', 'Flutter/Dart pub package cache', true),
  t('android-cache', 'Android Cache', `${HOME}/.android/cache`, 'developer', 'Android SDK and build cache', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — Code editors
  // ═══════════════════════════════════════════════════════════════
  t('vscode-cache', 'VS Code Cache', `${HOME}/Library/Application Support/Code/Cache`, 'developer', 'Visual Studio Code cache', true),
  t('vscode-cacheddata', 'VS Code Cached Data', `${HOME}/Library/Application Support/Code/CachedData`, 'developer', 'VS Code compiled extension cache', true),
  t('vscode-logs', 'VS Code Logs', `${HOME}/Library/Application Support/Code/logs`, 'developer', 'VS Code log files', true),
  t('vscode-ext-cache', 'VS Code Extensions Cache', `${HOME}/Library/Application Support/Code/CachedExtensions`, 'developer', 'VS Code extension cache', true),
  t('sublime-cache', 'Sublime Text Cache', `${HOME}/Library/Caches/com.sublimetext.4`, 'developer', 'Sublime Text editor cache', true),
  t('vscode-insiders-cache', 'VS Code Insiders Cache', `${HOME}/Library/Application Support/Code - Insiders/Cache`, 'developer', 'VS Code Insiders cache', true),
  t('vscode-insiders-cacheddata', 'VS Code Insiders Cached Data', `${HOME}/Library/Application Support/Code - Insiders/CachedData`, 'developer', 'VS Code Insiders compiled extension cache', true),
  t('zed-node', 'Zed Node Runtime', `${HOME}/Library/Application Support/Zed/node`, 'developer', 'Node runtime Zed downloads for language servers', true),
  t('zed-cache', 'Zed Cache', `${HOME}/Library/Caches/dev.zed.Zed`, 'developer', 'Zed editor cache', true),
  t('zed-logs', 'Zed Logs', `${HOME}/Library/Logs/Zed`, 'developer', 'Zed log files', true),
  t('jetbrains-cache', 'JetBrains Caches', `${HOME}/Library/Caches/JetBrains`, 'developer', 'IntelliJ, WebStorm, PyCharm and friends — indexes and caches', true),
  t('jetbrains-logs', 'JetBrains Logs', `${HOME}/Library/Logs/JetBrains`, 'developer', 'JetBrains IDE logs', true),
  t('github-desktop-cache', 'GitHub Desktop Cache', `${HOME}/Library/Application Support/GitHub Desktop/Cache`, 'developer', 'GitHub Desktop web cache', true),

  // ═══════════════════════════════════════════════════════════════
  // HOMEBREW
  // ═══════════════════════════════════════════════════════════════
  t('homebrew-cache', 'Homebrew Cache', `${HOME}/Library/Caches/Homebrew`, 'homebrew', 'Downloaded homebrew package archives', true),
  t('homebrew-logs', 'Homebrew Logs', `${HOME}/Library/Logs/Homebrew`, 'homebrew', 'Homebrew build and install logs', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Communication
  // ═══════════════════════════════════════════════════════════════
  t('slack-cache', 'Slack Cache', `${HOME}/Library/Application Support/Slack/Cache`, 'application', 'Slack cached data and media', true),
  t('slack-sw', 'Slack Service Workers', `${HOME}/Library/Application Support/Slack/Service Worker/CacheStorage`, 'application', 'Slack service worker cache', true),
  t('discord-cache', 'Discord Cache', `${HOME}/Library/Application Support/discord/Cache`, 'application', 'Discord cached media and data', true),
  t('teams-cache', 'Teams Cache', `${HOME}/Library/Caches/com.microsoft.teams2`, 'application', 'Microsoft Teams cached data', true),
  t('teams-legacy-cache', 'Teams Legacy Cache', `${HOME}/Library/Application Support/Microsoft/Teams/Cache`, 'application', 'Teams legacy cache', true),
  t('teams-legacy-logs', 'Teams Legacy Logs', `${HOME}/Library/Application Support/Microsoft/Teams/logs`, 'application', 'Teams legacy logs', true),
  t('zoom-cache', 'Zoom Cache', `${HOME}/Library/Caches/us.zoom.xos`, 'application', 'Zoom meeting data cache', true),
  t('telegram-cache', 'Telegram Cache', `${HOME}/Library/Caches/ru.keepcoder.Telegram`, 'application', 'Telegram Desktop cache', true),
  t('whatsapp-cache', 'WhatsApp Cache', `${HOME}/Library/Caches/net.whatsapp.WhatsApp`, 'application', 'WhatsApp Desktop cache', true),
  t('skype-cache', 'Skype Cache', `${HOME}/Library/Caches/com.skype.skype`, 'application', 'Skype cache', true),
  t('wechat-cache', 'WeChat Cache', `${HOME}/Library/Caches/com.tencent.xinWeChat`, 'application', 'WeChat cache', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — AI Assistants
  //
  // The heaviest category on a machine that codes with agents, and the one the
  // list used to say almost nothing about. Sandbox images, downloaded runtimes
  // and per-session transcripts each run to gigabytes and none of them showed
  // up here. The transcript stores are `c()` — they are the biggest single
  // entries and the only ones that lose something real.
  // ═══════════════════════════════════════════════════════════════
  t('chatgpt-cache', 'ChatGPT Cache', `${HOME}/Library/Caches/com.openai.chat`, 'application', 'ChatGPT desktop cache', true),
  t('claude-cache', 'Claude Cache', `${HOME}/Library/Caches/com.anthropic.claudefordesktop`, 'application', 'Claude desktop cache', true),
  t('claude-logs', 'Claude Logs', `${HOME}/Library/Logs/Claude`, 'application', 'Claude desktop logs', true),
  // Claude Desktop
  t('claude-vm-bundles', 'Claude VM Bundles', `${HOME}/Library/Application Support/Claude/vm_bundles`, 'application', 'Sandbox VM images, re-downloaded when a sandboxed session next needs one', true),
  t('claude-code-vm', 'Claude Code VM', `${HOME}/Library/Application Support/Claude/claude-code-vm`, 'application', 'Claude Code sandbox runtime, re-downloaded on demand', true),
  t('claude-desktop-cache', 'Claude Desktop Cache', `${HOME}/Library/Application Support/Claude/Cache`, 'application', 'Claude desktop web cache', true),
  t('claude-desktop-code-cache', 'Claude Desktop Code Cache', `${HOME}/Library/Application Support/Claude/Code Cache`, 'application', 'Claude desktop compiled script cache', true),
  t('claude-desktop-gpu', 'Claude Desktop GPU Cache', `${HOME}/Library/Application Support/Claude/GPUCache`, 'application', 'Claude desktop GPU shader cache', true),
  t('claude-desktop-crashpad', 'Claude Desktop Crash Dumps', `${HOME}/Library/Application Support/Claude/Crashpad`, 'application', 'Claude desktop crash dumps', true),
  // Claude Code
  t('claude-code-shell-snapshots', 'Claude Code Shell Snapshots', `${HOME}/.claude/shell-snapshots`, 'developer', 'Captured shell environments, rebuilt each session', true),
  t('claude-code-debug', 'Claude Code Debug Logs', `${HOME}/.claude/debug`, 'developer', 'Claude Code debug logs', true),
  t('claude-code-cache', 'Claude Code Cache', `${HOME}/.claude/cache`, 'developer', 'Claude Code internal cache', true),
  t('claude-code-paste-cache', 'Claude Code Paste Cache', `${HOME}/.claude/paste-cache`, 'developer', 'Images and text pasted into Claude Code', true),
  t('claude-code-downloads', 'Claude Code Downloads', `${HOME}/.claude/downloads`, 'developer', 'Files Claude Code downloaded during sessions', true),
  c('claude-code-projects', 'Claude Code Session History', `${HOME}/.claude/projects`, 'developer', 'Full transcripts of every Claude Code session — cleaning ends --resume and --continue for past work', true),
  // Codex
  t('codex-cache', 'Codex Cache', `${HOME}/Library/Caches/com.openai.codex`, 'developer', 'Codex CLI cache', true),
  t('codex-runtimes', 'Codex Runtimes', `${HOME}/.cache/codex-runtimes`, 'developer', 'Downloaded Codex runtime images, re-fetched on demand', true),
  t('codex-internal-cache', 'Codex Internal Cache', `${HOME}/.codex/cache`, 'developer', 'Codex working cache', true),
  t('codex-logs', 'Codex Logs', `${HOME}/Library/Logs/com.openai.codex`, 'developer', 'Codex CLI logs', true),
  c('codex-sessions', 'Codex Sessions', `${HOME}/.codex/sessions`, 'developer', 'Transcripts of current Codex sessions', true),
  c('codex-archived-sessions', 'Codex Archived Sessions', `${HOME}/.codex/archived_sessions`, 'developer', 'Transcripts of past Codex sessions — usually the largest single directory on an agent-heavy machine', true),
  // Codex desktop (Chromium-based)
  t('codex-app-crx', 'Codex App Component Cache', `${HOME}/Library/Application Support/Codex/component_crx_cache`, 'application', 'Codex desktop component downloads', true),
  t('codex-app-crashpad', 'Codex App Crash Dumps', `${HOME}/Library/Application Support/Codex/Crashpad`, 'application', 'Codex desktop crash dumps', true),
  t('codex-app-gpu', 'Codex App GPU Cache', `${HOME}/Library/Application Support/Codex/GraphiteDawnCache`, 'application', 'Codex desktop GPU shader cache', true),
  // opencode
  t('opencode-cache', 'opencode Cache', `${HOME}/.cache/opencode`, 'developer', 'opencode CLI cache', true),
  t('opencode-desktop-cache', 'opencode Desktop Cache', `${HOME}/Library/Application Support/ai.opencode.desktop/Cache`, 'application', 'opencode desktop web cache', true),
  t('opencode-desktop-crashpad', 'opencode Crash Dumps', `${HOME}/Library/Application Support/ai.opencode.desktop/Crashpad`, 'application', 'opencode desktop crash dumps', true),
  // Kimi
  t('kimi-cache', 'Kimi Cache', `${HOME}/Library/Application Support/kimi-desktop/Cache`, 'application', 'Kimi desktop web cache', true),
  t('kimi-code-cache', 'Kimi Code Cache', `${HOME}/Library/Application Support/kimi-desktop/Code Cache`, 'application', 'Kimi desktop compiled script cache', true),
  // Cursor / Windsurf
  t('cursor-cache', 'Cursor Cache', `${HOME}/Library/Application Support/Cursor/Cache`, 'developer', 'Cursor editor cache', true),
  t('cursor-cacheddata', 'Cursor Cached Data', `${HOME}/Library/Application Support/Cursor/CachedData`, 'developer', 'Cursor compiled extension cache', true),
  t('cursor-logs', 'Cursor Logs', `${HOME}/Library/Application Support/Cursor/logs`, 'developer', 'Cursor log files', true),
  t('windsurf-cache', 'Windsurf Cache', `${HOME}/Library/Application Support/Windsurf/Cache`, 'developer', 'Windsurf editor cache', true),
  // Local models — gigabytes each, and a re-download rather than a rebuild
  c('ollama-models', 'Ollama Models', `${HOME}/.ollama/models`, 'developer', 'Downloaded Ollama models — each has to be pulled again', true),
  c('lmstudio-models', 'LM Studio Models', `${HOME}/.cache/lm-studio/models`, 'developer', 'Downloaded LM Studio models — each has to be pulled again', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Media & Music
  // ═══════════════════════════════════════════════════════════════
  t('spotify-cache', 'Spotify Cache', `${HOME}/Library/Caches/com.spotify.client`, 'application', 'Spotify streaming and offline cache', true),
  t('apple-music-cache', 'Apple Music Cache', `${HOME}/Library/Caches/com.apple.Music`, 'application', 'Apple Music cache', true),
  t('apple-podcasts', 'Apple Podcasts Cache', `${HOME}/Library/Caches/com.apple.podcasts`, 'application', 'Apple Podcasts cache', true),
  t('apple-tv-cache', 'Apple TV Cache', `${HOME}/Library/Caches/com.apple.TV`, 'application', 'Apple TV app cache', true),
  t('plex-cache', 'Plex Cache', `${HOME}/Library/Caches/tv.plex.player.desktop`, 'application', 'Plex media player cache', true),
  t('iina-cache', 'IINA Cache', `${HOME}/Library/Caches/com.colliderli.iina`, 'application', 'IINA video player cache', true),
  t('vlc-cache', 'VLC Cache', `${HOME}/Library/Caches/org.videolan.vlc`, 'application', 'VLC media player cache', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Design & Creative
  // ═══════════════════════════════════════════════════════════════
  t('figma-cache', 'Figma Cache', `${HOME}/Library/Caches/com.figma.Desktop`, 'application', 'Figma design file cache', true),
  t('sketch-cache', 'Sketch Cache', `${HOME}/Library/Caches/com.bohemiancoding.sketch3`, 'application', 'Sketch design cache', true),
  t('sketch-app-cache', 'Sketch App Cache', `${HOME}/Library/Application Support/com.bohemiancoding.sketch3/cache`, 'application', 'Sketch application support cache', true),
  t('adobe-cache', 'Adobe Caches', `${HOME}/Library/Caches/Adobe`, 'application', 'Adobe Creative Cloud app caches', true),
  t('adobe-media', 'Adobe Media Cache', `${HOME}/Library/Application Support/Adobe/Common/Media Cache Files`, 'application', 'Adobe media cache files', true),
  t('finalcut-cache', 'Final Cut Pro Cache', `${HOME}/Library/Caches/com.apple.FinalCut`, 'application', 'Final Cut Pro render cache', true),
  t('davinci-cache', 'DaVinci Resolve Cache', `${HOME}/Library/Caches/com.blackmagic-design.DaVinciResolve`, 'application', 'DaVinci Resolve cache', true),
  t('blender-cache', 'Blender Cache', `${HOME}/Library/Caches/org.blenderfoundation.blender`, 'application', 'Blender 3D cache', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Gaming
  // ═══════════════════════════════════════════════════════════════
  t('steam-cache', 'Steam Cache', `${HOME}/Library/Caches/com.valvesoftware.steam`, 'application', 'Steam client cache', true),
  t('steam-htmlcache', 'Steam Web Cache', `${HOME}/Library/Application Support/Steam/htmlcache`, 'application', 'Steam built-in browser cache', true),
  t('steam-appcache', 'Steam App Cache', `${HOME}/Library/Application Support/Steam/appcache`, 'application', 'Steam application cache', true),
  t('steam-shadercache', 'Steam Shader Cache', `${HOME}/Library/Application Support/Steam/steamapps/shadercache`, 'application', 'Steam compiled shader cache', true),
  t('steam-logs', 'Steam Logs', `${HOME}/Library/Application Support/Steam/logs`, 'application', 'Steam log files', true),
  t('epicgames-cache', 'Epic Games Cache', `${HOME}/Library/Caches/com.epicgames.EpicGamesLauncher`, 'application', 'Epic Games Launcher cache', true),
  t('battlenet-cache', 'Battle.net Cache', `${HOME}/Library/Caches/com.blizzard.Battle.net`, 'application', 'Blizzard Battle.net cache', true),
  t('battlenet-app', 'Battle.net App Cache', `${HOME}/Library/Application Support/Battle.net/Cache`, 'application', 'Battle.net app cache', true),
  t('minecraft-logs', 'Minecraft Logs', `${HOME}/Library/Application Support/minecraft/logs`, 'application', 'Minecraft logs', true),
  t('minecraft-crash', 'Minecraft Crash Reports', `${HOME}/Library/Application Support/minecraft/crash-reports`, 'application', 'Minecraft crash reports', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Notes & Productivity
  // ═══════════════════════════════════════════════════════════════
  t('notion-cache', 'Notion Cache', `${HOME}/Library/Caches/notion.id`, 'application', 'Notion cache', true),
  t('obsidian-cache', 'Obsidian Cache', `${HOME}/Library/Caches/md.obsidian`, 'application', 'Obsidian vault cache', true),
  t('logseq-cache', 'Logseq Cache', `${HOME}/Library/Caches/com.logseq.logseq`, 'application', 'Logseq cache', true),
  t('evernote-cache', 'Evernote Cache', `${HOME}/Library/Caches/com.evernote.Evernote`, 'application', 'Evernote cache', true),
  t('todoist-cache', 'Todoist Cache', `${HOME}/Library/Caches/com.todoist.mac.Todoist`, 'application', 'Todoist cache', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Cloud Storage
  // ═══════════════════════════════════════════════════════════════
  t('dropbox-cache', 'Dropbox Cache', `${HOME}/.dropbox/cache`, 'application', 'Dropbox sync cache', true),
  t('onedrive-cache', 'OneDrive Cache', `${HOME}/Library/Caches/com.microsoft.OneDrive`, 'application', 'OneDrive cache', true),
  t('gdrive-cache', 'Google Drive Cache', `${HOME}/Library/Caches/com.google.GoogleDrive`, 'application', 'Google Drive cache', true),
  t('box-cache', 'Box Cache', `${HOME}/Library/Caches/com.box.desktop`, 'application', 'Box sync cache', true),
  t('icloud-cache', 'iCloud Cache', `${HOME}/Library/Caches/com.apple.CloudDocs.MobileDocumentsFileProvider`, 'application', 'iCloud Drive cache', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Remote Desktop & Utilities
  // ═══════════════════════════════════════════════════════════════
  t('teamviewer-cache', 'TeamViewer Cache', `${HOME}/Library/Caches/com.teamviewer.TeamViewer`, 'application', 'TeamViewer cache', true),
  t('anydesk-cache', 'AnyDesk Cache', `${HOME}/Library/Caches/com.anydesk.anydesk`, 'application', 'AnyDesk cache', true),
  t('alfred-cache', 'Alfred Cache', `${HOME}/Library/Caches/com.runningwithcrayons.Alfred`, 'application', 'Alfred launcher cache', true),
  t('unarchiver-cache', 'The Unarchiver Cache', `${HOME}/Library/Caches/cx.c3.theunarchiver`, 'application', 'The Unarchiver cache', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Download Managers
  // ═══════════════════════════════════════════════════════════════
  t('transmission-cache', 'Transmission Cache', `${HOME}/Library/Caches/org.m0k.transmission`, 'application', 'Transmission torrent cache', true),
  t('qbittorrent-cache', 'qBittorrent Cache', `${HOME}/Library/Caches/com.qbittorrent.qBittorrent`, 'application', 'qBittorrent cache', true),

  // ═══════════════════════════════════════════════════════════════
  // SYSTEM — Deep system cleaning
  // ═══════════════════════════════════════════════════════════════
  t('saved-state', 'Saved Application State', macPaths.savedState, 'system', 'Application window positions and restore data', true),
  t('ios-backups', 'iOS Backups', `${HOME}/Library/Application Support/MobileSync/Backup`, 'system', 'iOS device backup files (can be very large)', true),
  t('ios-updates', 'iOS Software Updates', `${HOME}/Library/iTunes/iPhone Software Updates`, 'system', 'Downloaded iOS update IPSW files', true),
  t('mail-attachments', 'Mail Attachments', `${HOME}/Library/Containers/com.apple.mail/Data/Library/Mail Downloads`, 'system', 'Mail.app downloaded attachment cache', true),
  t('mail-downloads', 'Mail Downloads', `${HOME}/Library/Mail Downloads`, 'system', 'Old Mail downloaded attachments', true),
  t('recent-items', 'Recent Items Lists', `${HOME}/Library/Application Support/com.apple.sharedfilelist`, 'system', 'Recent apps, documents, and servers lists', true),
  t('crashreporter-support', 'Crash Reporter Data', `${HOME}/Library/Application Support/CrashReporter`, 'system', 'Crash reporter working files', true),
  t('geoservices-cache', 'Maps & Location Cache', `${HOME}/Library/Caches/GeoServices`, 'system', 'Downloaded map tiles and location lookups', true),
  t('helpd-cache', 'Help Viewer Cache', `${HOME}/Library/Caches/com.apple.helpd`, 'system', 'Downloaded application help books', true),
  t('parsecd-cache', 'Siri Suggestions Cache', `${HOME}/Library/Caches/com.apple.parsecd`, 'system', 'Siri suggestions and Spotlight web results cache', true),
  t('visual-intelligence-cache', 'Visual Intelligence Cache', `${HOME}/Library/Caches/com.apple.VisualIntelligenceCore`, 'system', 'On-device image analysis cache', true),
  t('appstore-cache', 'App Store Cache', `${HOME}/Library/Caches/com.apple.appstoreagent`, 'system', 'App Store artwork and metadata cache', true),
  t('raycast-cache', 'Raycast Cache', `${HOME}/Library/Caches/com.raycast.macos`, 'application', 'Raycast launcher cache', true),
  t('private-tmp', 'System Temp Files', '/private/tmp', 'system', 'System temporary files', true, true),
  t('private-var-tmp', 'System Var Temp', '/private/var/tmp', 'system', 'System variable temp files', true, true),
  t('diagnostic-logs', 'Diagnostic Logs', '/private/var/db/diagnostics', 'system', 'System diagnostic logs', true, true),
  t('powerlog', 'Power Logs', '/private/var/db/powerlog', 'system', 'System power usage logs', true, true),

  // ═══════════════════════════════════════════════════════════════
  // SYSTEM — Shell & Terminal
  // ═══════════════════════════════════════════════════════════════
  t('zsh-compdump', 'Zsh Completion Cache', `${HOME}/.zcompdump`, 'system', 'Zsh completion dump (rebuilt on next shell start)', false),
  t('less-history', 'less History', `${HOME}/.lesshst`, 'system', 'less pager history file', false),
  t('wget-hsts', 'wget HSTS Cache', `${HOME}/.wget-hsts`, 'system', 'wget HTTP Strict Transport Security cache', false),

  // ═══════════════════════════════════════════════════════════════
  // TRASH
  // ═══════════════════════════════════════════════════════════════
  t('trash', 'Trash', macPaths.trash, 'trash', 'Files in your Trash', true),
]

// ── Helpers ────────────────────────────────────────────────────

function t(
  id: string,
  name: string,
  p: string,
  category: CleanTarget['category'],
  description: string,
  contentsOnly = true,
  requiresSudo = false,
  skipPatterns?: string[],
): CleanTarget {
  return { id, name, path: p, icon: iconForCategory(category), category, description, contentsOnly, requiresSudo, risk: 'safe', skipPatterns }
}

/**
 * A target holding content the machine cannot get back on its own — session
 * transcripts, downloaded models, VM boxes. Same shape as `t()`, marked so the
 * UI can keep it out of "Select All" and label it.
 */
function c(
  id: string,
  name: string,
  p: string,
  category: CleanTarget['category'],
  description: string,
  contentsOnly = true,
): CleanTarget {
  return { ...t(id, name, p, category, description, contentsOnly), risk: 'caution' }
}

/**
 * Get all clean targets, optionally filtered by category
 */
export function getCleanTargets(categories?: string[]): CleanTarget[] {
  if (!categories || categories.length === 0)
    return CLEAN_TARGETS
  return CLEAN_TARGETS.filter(t => categories.includes(t.category))
}

/**
 * Get a specific clean target by ID
 */
export function getCleanTarget(id: string): CleanTarget | undefined {
  return CLEAN_TARGETS.find(t => t.id === id)
}

/**
 * Get all unique categories
 */
export function getCategories(): string[] {
  return [...new Set(CLEAN_TARGETS.map(t => t.category))]
}
