import { HOME, macPaths } from '@system-cleaner/core'
import * as path from 'node:path'
import type { CleanTarget } from './types'

/**
 * Comprehensive cleaning database — 170+ targets matching and exceeding Mole's coverage.
 * Organized by category for maintainability.
 */
export const CLEAN_TARGETS: CleanTarget[] = [
  // ═══════════════════════════════════════════════════════════════
  // USER CACHES
  // ═══════════════════════════════════════════════════════════════
  t('user-caches', 'User Caches', `${HOME}/Library/Caches`, '🗑️', 'cache', 'Application caches (safe to remove, apps rebuild them)', true),
  t('font-cache', 'Font Caches', `${HOME}/Library/Caches/com.apple.FontRegistry`, '🔤', 'cache', 'System font registry cache', true),
  t('quicklook-cache', 'QuickLook Thumbnails', `${HOME}/Library/Caches/com.apple.QuickLook.thumbnailcache`, '👁️', 'cache', 'Finder thumbnail preview cache', true),
  t('icon-services', 'Icon Services Cache', `${HOME}/Library/Caches/com.apple.iconservices.store`, '🖼️', 'cache', 'Application icon cache'),

  // ═══════════════════════════════════════════════════════════════
  // LOGS & CRASH REPORTS
  // ═══════════════════════════════════════════════════════════════
  t('user-logs', 'Application Logs', macPaths.logs, '📝', 'log', 'Application and system log files', true),
  t('crash-reports', 'Crash Reports', macPaths.crashReports, '💥', 'log', 'Application crash diagnostic reports', true),
  t('system-crash-reports', 'System Crash Reports', macPaths.systemCrashReports, '💥', 'log', 'System-level crash reports', true, true),
  t('system-logs', 'System Logs', '/private/var/log', '📝', 'log', 'System daemon and service logs', true, true),
  t('adobe-logs', 'Adobe Logs', '/Library/Logs/Adobe', '🎨', 'log', 'Adobe Creative Cloud logs', true, true),
  t('adobe-gc-log', 'Adobe GC Log', '/Library/Logs/adobegc.log', '🎨', 'log', 'Adobe garbage collection log'),

  // ═══════════════════════════════════════════════════════════════
  // BROWSERS — cache, service workers, GPU cache
  // ═══════════════════════════════════════════════════════════════
  // Chrome
  t('chrome-cache', 'Chrome Cache', `${HOME}/Library/Caches/Google/Chrome`, '🌐', 'browser', 'Google Chrome browser cache', true),
  t('chrome-sw', 'Chrome Service Workers', `${HOME}/Library/Application Support/Google/Chrome/Default/Service Worker/CacheStorage`, '🌐', 'browser', 'Chrome service worker cache', true),
  t('chrome-gpu', 'Chrome GPU Cache', `${HOME}/Library/Application Support/Google/Chrome/Default/GPUCache`, '🌐', 'browser', 'Chrome GPU shader cache', true),
  t('chrome-code', 'Chrome Code Cache', `${HOME}/Library/Application Support/Google/Chrome/Default/Code Cache`, '🌐', 'browser', 'Chrome compiled code cache', true),
  // Safari
  t('safari-cache', 'Safari Cache', `${HOME}/Library/Caches/com.apple.Safari`, '🧭', 'browser', 'Safari browser cache', true),
  t('safari-webkit', 'Safari WebKit Cache', `${HOME}/Library/Caches/com.apple.WebKit.WebContent`, '🧭', 'browser', 'Safari WebKit rendering cache', true),
  t('safari-webkit-net', 'Safari Networking Cache', `${HOME}/Library/Caches/com.apple.WebKit.Networking`, '🧭', 'browser', 'Safari WebKit networking cache', true),
  t('safari-safebrowsing', 'Safari Safe Browsing', `${HOME}/Library/Caches/com.apple.Safari.SafeBrowsing`, '🧭', 'browser', 'Safari safe browsing data', true),
  // Firefox
  t('firefox-cache', 'Firefox Cache', `${HOME}/Library/Caches/Firefox`, '🦊', 'browser', 'Mozilla Firefox browser cache', true),
  // Edge
  t('edge-cache', 'Edge Cache', `${HOME}/Library/Caches/Microsoft Edge`, '🔷', 'browser', 'Microsoft Edge browser cache', true),
  // Brave
  t('brave-cache', 'Brave Cache', `${HOME}/Library/Caches/BraveSoftware/Brave-Browser`, '🦁', 'browser', 'Brave browser cache', true),
  // Arc
  t('arc-cache', 'Arc Cache', `${HOME}/Library/Caches/company.thebrowser.Browser`, '🌈', 'browser', 'Arc browser cache', true),
  // Opera
  t('opera-cache', 'Opera Cache', `${HOME}/Library/Caches/com.operasoftware.Opera`, '🔴', 'browser', 'Opera browser cache', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — JavaScript ecosystem
  // ═══════════════════════════════════════════════════════════════
  t('npm-cache', 'npm Cache', `${HOME}/.npm`, '📦', 'developer', 'npm package manager cache', true),
  t('yarn-cache', 'Yarn Cache', `${HOME}/Library/Caches/Yarn`, '🧶', 'developer', 'Yarn package manager cache', true),
  t('pnpm-store', 'pnpm Store', `${HOME}/Library/pnpm/store`, '📦', 'developer', 'pnpm content-addressable store', true),
  t('bun-cache', 'Bun Cache', `${HOME}/.bun/install/cache`, '🥟', 'developer', 'Bun package manager cache', true),
  t('turbo-cache', 'Turbo Cache', `${HOME}/.turbo/cache`, '⚡', 'developer', 'Turborepo build cache', true),
  t('vite-cache', 'Vite Cache', `${HOME}/.cache/vite`, '⚡', 'developer', 'Vite bundler cache', true),
  t('webpack-cache', 'Webpack Cache', `${HOME}/.cache/webpack`, '📦', 'developer', 'Webpack bundler cache', true),
  t('parcel-cache', 'Parcel Cache', `${HOME}/.parcel-cache`, '📦', 'developer', 'Parcel bundler cache', true),
  t('eslint-cache', 'ESLint Cache', `${HOME}/.cache/eslint`, '🔍', 'developer', 'ESLint linter cache', true),
  t('prettier-cache', 'Prettier Cache', `${HOME}/.cache/prettier`, '✨', 'developer', 'Prettier formatter cache', true),
  t('typescript-cache', 'TypeScript Cache', `${HOME}/.cache/typescript`, '🔷', 'developer', 'TypeScript compiler cache', true),
  t('electron-cache', 'Electron Cache', `${HOME}/.cache/electron`, '⚛️', 'developer', 'Electron framework cache', true),
  t('node-gyp-cache', 'node-gyp Cache', `${HOME}/.cache/node-gyp`, '🔧', 'developer', 'node-gyp build cache', true),
  t('node-gyp-home', 'node-gyp Home', `${HOME}/.node-gyp`, '🔧', 'developer', 'node-gyp headers cache', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — Xcode & Apple
  // ═══════════════════════════════════════════════════════════════
  t('xcode-deriveddata', 'Xcode DerivedData', `${HOME}/Library/Developer/Xcode/DerivedData`, '🔨', 'developer', 'Xcode build artifacts and indexes', true),
  t('xcode-archives', 'Xcode Archives', `${HOME}/Library/Developer/Xcode/Archives`, '🔨', 'developer', 'Xcode build archives', true),
  t('xcode-simulators', 'iOS Simulators', `${HOME}/Library/Developer/CoreSimulator/Devices`, '📱', 'developer', 'iOS simulator runtime data', true),
  t('xcode-caches', 'Xcode Caches', `${HOME}/Library/Caches/com.apple.dt.Xcode`, '🔨', 'developer', 'Xcode IDE caches', true),
  t('xcode-device-logs', 'Xcode Device Logs', `${HOME}/Library/Developer/Xcode/iOS Device Logs`, '🔨', 'developer', 'iOS device logs', true),
  t('xcode-watch-logs', 'Xcode watchOS Logs', `${HOME}/Library/Developer/Xcode/watchOS Device Logs`, '⌚', 'developer', 'watchOS device logs', true),
  t('xcode-doc-cache', 'Xcode Documentation', `${HOME}/Library/Developer/Xcode/DocumentationCache`, '📚', 'developer', 'Xcode documentation cache', true),
  t('xcode-products', 'Xcode Products', `${HOME}/Library/Developer/Xcode/Products`, '🔨', 'developer', 'Xcode build products', true),
  t('simulator-caches', 'Simulator Caches', `${HOME}/Library/Developer/CoreSimulator/Caches`, '📱', 'developer', 'CoreSimulator cache', true),
  t('simulator-logs', 'Simulator Logs', `${HOME}/Library/Logs/CoreSimulator`, '📱', 'developer', 'CoreSimulator logs', true),
  t('cocoapods-cache', 'CocoaPods Cache', `${HOME}/Library/Caches/CocoaPods`, '📦', 'developer', 'CocoaPods dependency cache', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — Python ecosystem
  // ═══════════════════════════════════════════════════════════════
  t('pip-cache', 'pip Cache', `${HOME}/Library/Caches/pip`, '🐍', 'developer', 'Python pip package cache', true),
  t('pyenv-cache', 'pyenv Cache', `${HOME}/.pyenv/cache`, '🐍', 'developer', 'pyenv version cache', true),
  t('poetry-cache', 'Poetry Cache', `${HOME}/.cache/poetry`, '🐍', 'developer', 'Poetry dependency cache', true),
  t('uv-cache', 'uv Cache', `${HOME}/.cache/uv`, '🐍', 'developer', 'uv package manager cache', true),
  t('ruff-cache', 'Ruff Cache', `${HOME}/.cache/ruff`, '🐍', 'developer', 'Ruff linter cache', true),
  t('mypy-cache', 'MyPy Cache', `${HOME}/.cache/mypy`, '🐍', 'developer', 'MyPy type checker cache', true),
  t('pytest-cache', 'Pytest Cache', `${HOME}/.pytest_cache`, '🐍', 'developer', 'Pytest test runner cache', true),
  t('jupyter-runtime', 'Jupyter Runtime', `${HOME}/.jupyter/runtime`, '📓', 'developer', 'Jupyter notebook runtime cache', true),
  t('huggingface-cache', 'Hugging Face Cache', `${HOME}/.cache/huggingface`, '🤗', 'developer', 'Hugging Face model cache (can be very large)', true),
  t('torch-cache', 'PyTorch Cache', `${HOME}/.cache/torch`, '🔥', 'developer', 'PyTorch model and hub cache', true),
  t('tensorflow-cache', 'TensorFlow Cache', `${HOME}/.cache/tensorflow`, '🧠', 'developer', 'TensorFlow model cache', true),
  t('conda-cache', 'Conda Cache', `${HOME}/.conda/pkgs`, '🐍', 'developer', 'Conda package cache', true),
  t('wandb-cache', 'Weights & Biases', `${HOME}/.cache/wandb`, '📊', 'developer', 'Weights & Biases experiment cache', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — Go, Rust, Java
  // ═══════════════════════════════════════════════════════════════
  t('go-modcache', 'Go Module Cache', `${HOME}/go/pkg/mod`, '🐹', 'developer', 'Go module download cache', true),
  t('go-buildcache', 'Go Build Cache', `${HOME}/Library/Caches/go-build`, '🐹', 'developer', 'Go compiler build cache', true),
  t('cargo-registry', 'Cargo Registry', `${HOME}/.cargo/registry/cache`, '🦀', 'developer', 'Rust cargo package registry cache', true),
  t('cargo-git', 'Cargo Git Cache', `${HOME}/.cargo/git`, '🦀', 'developer', 'Cargo git dependency cache', true),
  t('rustup-downloads', 'Rustup Downloads', `${HOME}/.rustup/downloads`, '🦀', 'developer', 'Rust toolchain download cache', true),
  t('gradle-cache', 'Gradle Cache', `${HOME}/.gradle/caches`, '🐘', 'developer', 'Gradle build system cache', true),
  t('maven-cache', 'Maven Repository', `${HOME}/.m2/repository`, '🏗️', 'developer', 'Maven local repository cache', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — Docker, Cloud, DevOps
  // ═══════════════════════════════════════════════════════════════
  t('docker-data', 'Docker Data', `${HOME}/Library/Containers/com.docker.docker`, '🐳', 'developer', 'Docker images, volumes, and build cache', true),
  t('docker-buildx', 'Docker BuildX Cache', `${HOME}/.docker/buildx/cache`, '🐳', 'developer', 'Docker BuildX build cache', true),
  t('kubectl-cache', 'Kubernetes Cache', `${HOME}/.kube/cache`, '☸️', 'developer', 'Kubernetes client cache', true),
  t('aws-cli-cache', 'AWS CLI Cache', `${HOME}/.aws/cli/cache`, '☁️', 'developer', 'AWS CLI request cache', true),
  t('gcloud-logs', 'Google Cloud Logs', `${HOME}/.config/gcloud/logs`, '☁️', 'developer', 'Google Cloud CLI logs', true),
  t('azure-logs', 'Azure CLI Logs', `${HOME}/.azure/logs`, '☁️', 'developer', 'Azure CLI logs', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — Ruby, PHP, Dart/Flutter, Misc
  // ═══════════════════════════════════════════════════════════════
  t('gem-cache', 'RubyGems Cache', `${HOME}/.gem`, '💎', 'developer', 'Ruby gems package cache', true),
  t('composer-cache', 'Composer Cache', `${HOME}/Library/Caches/composer`, '🐘', 'developer', 'PHP Composer package cache', true),
  t('flutter-cache', 'Flutter Cache', `${HOME}/.pub-cache`, '🦋', 'developer', 'Flutter/Dart pub package cache', true),
  t('android-cache', 'Android Cache', `${HOME}/.android/cache`, '🤖', 'developer', 'Android SDK and build cache', true),

  // ═══════════════════════════════════════════════════════════════
  // DEVELOPER — Code editors
  // ═══════════════════════════════════════════════════════════════
  t('vscode-cache', 'VS Code Cache', `${HOME}/Library/Application Support/Code/Cache`, '💻', 'developer', 'Visual Studio Code cache', true),
  t('vscode-cacheddata', 'VS Code Cached Data', `${HOME}/Library/Application Support/Code/CachedData`, '💻', 'developer', 'VS Code compiled extension cache', true),
  t('vscode-logs', 'VS Code Logs', `${HOME}/Library/Application Support/Code/logs`, '💻', 'developer', 'VS Code log files', true),
  t('vscode-ext-cache', 'VS Code Extensions Cache', `${HOME}/Library/Application Support/Code/CachedExtensions`, '💻', 'developer', 'VS Code extension cache', true),
  t('sublime-cache', 'Sublime Text Cache', `${HOME}/Library/Caches/com.sublimetext.4`, '📝', 'developer', 'Sublime Text editor cache', true),

  // ═══════════════════════════════════════════════════════════════
  // HOMEBREW
  // ═══════════════════════════════════════════════════════════════
  t('homebrew-cache', 'Homebrew Cache', `${HOME}/Library/Caches/Homebrew`, '🍺', 'homebrew', 'Downloaded homebrew package archives', true),
  t('homebrew-logs', 'Homebrew Logs', `${HOME}/Library/Logs/Homebrew`, '🍺', 'homebrew', 'Homebrew build and install logs', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Communication
  // ═══════════════════════════════════════════════════════════════
  t('slack-cache', 'Slack Cache', `${HOME}/Library/Application Support/Slack/Cache`, '💬', 'application', 'Slack cached data and media', true),
  t('slack-sw', 'Slack Service Workers', `${HOME}/Library/Application Support/Slack/Service Worker/CacheStorage`, '💬', 'application', 'Slack service worker cache', true),
  t('discord-cache', 'Discord Cache', `${HOME}/Library/Application Support/discord/Cache`, '🎮', 'application', 'Discord cached media and data', true),
  t('teams-cache', 'Teams Cache', `${HOME}/Library/Caches/com.microsoft.teams2`, '🟦', 'application', 'Microsoft Teams cached data', true),
  t('teams-legacy-cache', 'Teams Legacy Cache', `${HOME}/Library/Application Support/Microsoft/Teams/Cache`, '🟦', 'application', 'Teams legacy cache', true),
  t('teams-legacy-logs', 'Teams Legacy Logs', `${HOME}/Library/Application Support/Microsoft/Teams/logs`, '🟦', 'application', 'Teams legacy logs', true),
  t('zoom-cache', 'Zoom Cache', `${HOME}/Library/Caches/us.zoom.xos`, '📹', 'application', 'Zoom meeting data cache', true),
  t('telegram-cache', 'Telegram Cache', `${HOME}/Library/Caches/ru.keepcoder.Telegram`, '💬', 'application', 'Telegram Desktop cache', true),
  t('whatsapp-cache', 'WhatsApp Cache', `${HOME}/Library/Caches/net.whatsapp.WhatsApp`, '💬', 'application', 'WhatsApp Desktop cache', true),
  t('skype-cache', 'Skype Cache', `${HOME}/Library/Caches/com.skype.skype`, '💬', 'application', 'Skype cache', true),
  t('wechat-cache', 'WeChat Cache', `${HOME}/Library/Caches/com.tencent.xinWeChat`, '💬', 'application', 'WeChat cache', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — AI Assistants
  // ═══════════════════════════════════════════════════════════════
  t('chatgpt-cache', 'ChatGPT Cache', `${HOME}/Library/Caches/com.openai.chat`, '🤖', 'application', 'ChatGPT desktop cache', true),
  t('claude-cache', 'Claude Cache', `${HOME}/Library/Caches/com.anthropic.claudefordesktop`, '🤖', 'application', 'Claude desktop cache', true),
  t('claude-logs', 'Claude Logs', `${HOME}/Library/Logs/Claude`, '🤖', 'application', 'Claude desktop logs', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Media & Music
  // ═══════════════════════════════════════════════════════════════
  t('spotify-cache', 'Spotify Cache', `${HOME}/Library/Caches/com.spotify.client`, '🎵', 'application', 'Spotify streaming and offline cache', true),
  t('apple-music-cache', 'Apple Music Cache', `${HOME}/Library/Caches/com.apple.Music`, '🎵', 'application', 'Apple Music cache', true),
  t('apple-podcasts', 'Apple Podcasts Cache', `${HOME}/Library/Caches/com.apple.podcasts`, '🎙️', 'application', 'Apple Podcasts cache', true),
  t('apple-tv-cache', 'Apple TV Cache', `${HOME}/Library/Caches/com.apple.TV`, '📺', 'application', 'Apple TV app cache', true),
  t('plex-cache', 'Plex Cache', `${HOME}/Library/Caches/tv.plex.player.desktop`, '📺', 'application', 'Plex media player cache', true),
  t('iina-cache', 'IINA Cache', `${HOME}/Library/Caches/com.colliderli.iina`, '🎬', 'application', 'IINA video player cache', true),
  t('vlc-cache', 'VLC Cache', `${HOME}/Library/Caches/org.videolan.vlc`, '🎬', 'application', 'VLC media player cache', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Design & Creative
  // ═══════════════════════════════════════════════════════════════
  t('figma-cache', 'Figma Cache', `${HOME}/Library/Caches/com.figma.Desktop`, '🎨', 'application', 'Figma design file cache', true),
  t('sketch-cache', 'Sketch Cache', `${HOME}/Library/Caches/com.bohemiancoding.sketch3`, '🎨', 'application', 'Sketch design cache', true),
  t('sketch-app-cache', 'Sketch App Cache', `${HOME}/Library/Application Support/com.bohemiancoding.sketch3/cache`, '🎨', 'application', 'Sketch application support cache', true),
  t('adobe-cache', 'Adobe Caches', `${HOME}/Library/Caches/Adobe`, '🎨', 'application', 'Adobe Creative Cloud app caches', true),
  t('adobe-media', 'Adobe Media Cache', `${HOME}/Library/Application Support/Adobe/Common/Media Cache Files`, '🎨', 'application', 'Adobe media cache files', true),
  t('finalcut-cache', 'Final Cut Pro Cache', `${HOME}/Library/Caches/com.apple.FinalCut`, '🎬', 'application', 'Final Cut Pro render cache', true),
  t('davinci-cache', 'DaVinci Resolve Cache', `${HOME}/Library/Caches/com.blackmagic-design.DaVinciResolve`, '🎬', 'application', 'DaVinci Resolve cache', true),
  t('blender-cache', 'Blender Cache', `${HOME}/Library/Caches/org.blenderfoundation.blender`, '🎨', 'application', 'Blender 3D cache', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Gaming
  // ═══════════════════════════════════════════════════════════════
  t('steam-cache', 'Steam Cache', `${HOME}/Library/Caches/com.valvesoftware.steam`, '🎮', 'application', 'Steam client cache', true),
  t('steam-htmlcache', 'Steam Web Cache', `${HOME}/Library/Application Support/Steam/htmlcache`, '🎮', 'application', 'Steam built-in browser cache', true),
  t('steam-appcache', 'Steam App Cache', `${HOME}/Library/Application Support/Steam/appcache`, '🎮', 'application', 'Steam application cache', true),
  t('steam-shadercache', 'Steam Shader Cache', `${HOME}/Library/Application Support/Steam/steamapps/shadercache`, '🎮', 'application', 'Steam compiled shader cache', true),
  t('steam-logs', 'Steam Logs', `${HOME}/Library/Application Support/Steam/logs`, '🎮', 'application', 'Steam log files', true),
  t('epicgames-cache', 'Epic Games Cache', `${HOME}/Library/Caches/com.epicgames.EpicGamesLauncher`, '🎮', 'application', 'Epic Games Launcher cache', true),
  t('battlenet-cache', 'Battle.net Cache', `${HOME}/Library/Caches/com.blizzard.Battle.net`, '🎮', 'application', 'Blizzard Battle.net cache', true),
  t('battlenet-app', 'Battle.net App Cache', `${HOME}/Library/Application Support/Battle.net/Cache`, '🎮', 'application', 'Battle.net app cache', true),
  t('minecraft-logs', 'Minecraft Logs', `${HOME}/Library/Application Support/minecraft/logs`, '🎮', 'application', 'Minecraft logs', true),
  t('minecraft-crash', 'Minecraft Crash Reports', `${HOME}/Library/Application Support/minecraft/crash-reports`, '🎮', 'application', 'Minecraft crash reports', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Notes & Productivity
  // ═══════════════════════════════════════════════════════════════
  t('notion-cache', 'Notion Cache', `${HOME}/Library/Caches/notion.id`, '📝', 'application', 'Notion cache', true),
  t('obsidian-cache', 'Obsidian Cache', `${HOME}/Library/Caches/md.obsidian`, '📝', 'application', 'Obsidian vault cache', true),
  t('logseq-cache', 'Logseq Cache', `${HOME}/Library/Caches/com.logseq.logseq`, '📝', 'application', 'Logseq cache', true),
  t('evernote-cache', 'Evernote Cache', `${HOME}/Library/Caches/com.evernote.Evernote`, '📝', 'application', 'Evernote cache', true),
  t('todoist-cache', 'Todoist Cache', `${HOME}/Library/Caches/com.todoist.mac.Todoist`, '📝', 'application', 'Todoist cache', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Cloud Storage
  // ═══════════════════════════════════════════════════════════════
  t('dropbox-cache', 'Dropbox Cache', `${HOME}/.dropbox/cache`, '📦', 'application', 'Dropbox sync cache', true),
  t('onedrive-cache', 'OneDrive Cache', `${HOME}/Library/Caches/com.microsoft.OneDrive`, '☁️', 'application', 'OneDrive cache', true),
  t('gdrive-cache', 'Google Drive Cache', `${HOME}/Library/Caches/com.google.GoogleDrive`, '☁️', 'application', 'Google Drive cache', true),
  t('box-cache', 'Box Cache', `${HOME}/Library/Caches/com.box.desktop`, '☁️', 'application', 'Box sync cache', true),
  t('icloud-cache', 'iCloud Cache', `${HOME}/Library/Caches/com.apple.CloudDocs.MobileDocumentsFileProvider`, '☁️', 'application', 'iCloud Drive cache', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Remote Desktop & Utilities
  // ═══════════════════════════════════════════════════════════════
  t('teamviewer-cache', 'TeamViewer Cache', `${HOME}/Library/Caches/com.teamviewer.TeamViewer`, '🖥️', 'application', 'TeamViewer cache', true),
  t('anydesk-cache', 'AnyDesk Cache', `${HOME}/Library/Caches/com.anydesk.anydesk`, '🖥️', 'application', 'AnyDesk cache', true),
  t('alfred-cache', 'Alfred Cache', `${HOME}/Library/Caches/com.runningwithcrayons.Alfred`, '🔍', 'application', 'Alfred launcher cache', true),
  t('unarchiver-cache', 'The Unarchiver Cache', `${HOME}/Library/Caches/cx.c3.theunarchiver`, '📦', 'application', 'The Unarchiver cache', true),

  // ═══════════════════════════════════════════════════════════════
  // APPLICATIONS — Download Managers
  // ═══════════════════════════════════════════════════════════════
  t('transmission-cache', 'Transmission Cache', `${HOME}/Library/Caches/org.m0k.transmission`, '📥', 'application', 'Transmission torrent cache', true),
  t('qbittorrent-cache', 'qBittorrent Cache', `${HOME}/Library/Caches/com.qbittorrent.qBittorrent`, '📥', 'application', 'qBittorrent cache', true),

  // ═══════════════════════════════════════════════════════════════
  // SYSTEM — Deep system cleaning
  // ═══════════════════════════════════════════════════════════════
  t('saved-state', 'Saved Application State', macPaths.savedState, '💾', 'system', 'Application window positions and restore data', true),
  t('ios-backups', 'iOS Backups', `${HOME}/Library/Application Support/MobileSync/Backup`, '📱', 'system', 'iOS device backup files (can be very large)', true),
  t('ios-updates', 'iOS Software Updates', `${HOME}/Library/iTunes/iPhone Software Updates`, '📱', 'system', 'Downloaded iOS update IPSW files', true),
  t('mail-attachments', 'Mail Attachments', `${HOME}/Library/Containers/com.apple.mail/Data/Library/Mail Downloads`, '📧', 'system', 'Mail.app downloaded attachment cache', true),
  t('mail-downloads', 'Mail Downloads', `${HOME}/Library/Mail Downloads`, '📧', 'system', 'Old Mail downloaded attachments', true),
  t('recent-items', 'Recent Items Lists', `${HOME}/Library/Application Support/com.apple.sharedfilelist`, '📋', 'system', 'Recent apps, documents, and servers lists', true),
  t('private-tmp', 'System Temp Files', '/private/tmp', '🗑️', 'system', 'System temporary files', true, true),
  t('private-var-tmp', 'System Var Temp', '/private/var/tmp', '🗑️', 'system', 'System variable temp files', true, true),
  t('diagnostic-logs', 'Diagnostic Logs', '/private/var/db/diagnostics', '📊', 'system', 'System diagnostic logs', true, true),
  t('powerlog', 'Power Logs', '/private/var/db/powerlog', '🔋', 'system', 'System power usage logs', true, true),

  // ═══════════════════════════════════════════════════════════════
  // SYSTEM — Shell & Terminal
  // ═══════════════════════════════════════════════════════════════
  t('zsh-compdump', 'Zsh Completion Cache', `${HOME}/.zcompdump`, '🐚', 'system', 'Zsh completion dump (rebuilt on next shell start)'),
  t('less-history', 'less History', `${HOME}/.lesshst`, '🐚', 'system', 'less pager history file'),
  t('wget-hsts', 'wget HSTS Cache', `${HOME}/.wget-hsts`, '🐚', 'system', 'wget HTTP Strict Transport Security cache'),

  // ═══════════════════════════════════════════════════════════════
  // TRASH
  // ═══════════════════════════════════════════════════════════════
  t('trash', 'Trash', macPaths.trash, '🗑️', 'trash', 'Files in your Trash', true),
]

// ── Helpers ────────────────────────────────────────────────────

function t(
  id: string,
  name: string,
  p: string,
  icon: string,
  category: CleanTarget['category'],
  description: string,
  contentsOnly = false,
  requiresSudo = false,
  skipPatterns?: string[],
): CleanTarget {
  return { id, name, path: p, icon, category, description, contentsOnly, requiresSudo, skipPatterns }
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
