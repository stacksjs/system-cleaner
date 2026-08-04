/**
 * Use cases: the marketing site's "who is this for" axis.
 *
 * The feature catalog answers "what does each tool do". This answers "what
 * does a day with SystemCleaner look like for me". Every `reclaims` entry
 * below names something the app actually targets — the clean-target table in
 * `packages/clean/src/categories.ts` or the project-artifact patterns in
 * `packages/disk/src/categories.ts`. Keep it that way: this file is a promise,
 * not a wish list.
 */

export interface UseCaseGroup {
  /** Heading for one cluster of reclaimable space. */
  title: string
  /** Concrete, verifiable targets. Written the way the app labels them. */
  items: string[]
}

export interface UseCaseStep {
  title: string
  body: string
}

export interface MarketingUseCase {
  slug: string
  /** Menu and page title. */
  name: string
  /** Compact label for the mobile sheet. */
  shortName: string
  /** Page headline. */
  headline: string
  /** One line, used in the mega menu and the index list. */
  summary: string
  /** Hero paragraph. */
  description: string
  /** Iconify `i-f7-*` suffix. */
  icon: string
  metric: string
  detail: string
  reclaims: UseCaseGroup[]
  workflow: UseCaseStep[]
  /** Feature slugs from the feature catalog, cross-linked at the page foot. */
  features: string[]
}

export const USE_CASES: MarketingUseCase[] = [
  {
    slug: 'developers',
    name: 'Developers',
    shortName: 'Developers',
    headline: 'Your toolchain is eating the disk. Get it back.',
    summary: 'Reclaim package registries, build caches, simulators, and containers without touching a repository.',
    description: 'Every language you install brings a cache, and none of them clean up after themselves. SystemCleaner knows where cargo, zig, npm, Xcode, Go, Python, and Docker keep their data, sizes each one, and lets you clear the ones you can afford to rebuild.',
    icon: 'chevron-left-slash-chevron-right',
    metric: 'Rebuildable only',
    detail: 'Targets are caches and downloads that a build regenerates, never your source.',
    reclaims: [
      {
        title: 'Rust and Zig',
        items: [
          'Cargo registry cache and unpacked crate sources',
          'Cargo git checkouts and rustup toolchain downloads',
          'sccache shared compilation cache',
          'Zig global cache, plus per-project .zig-cache and zig-out',
          'Rust target/ directories, found by size across your projects',
        ],
      },
      {
        title: 'JavaScript and TypeScript',
        items: [
          'npm, Yarn, pnpm store, Bun install cache, Deno cache',
          'Vite, webpack, Parcel, Turborepo, and node-gyp caches',
          'node_modules across every checkout, ranked largest first',
          'dist, build, .next, .nuxt, .svelte-kit output folders',
        ],
      },
      {
        title: 'Apple platforms',
        items: [
          'Xcode DerivedData, Archives, and build products',
          'iOS Simulator devices and CoreSimulator caches',
          'CocoaPods and Swift Package Manager caches',
          'Device and simulator logs',
        ],
      },
      {
        title: 'Go, JVM, Python, and containers',
        items: [
          'Go module and compiler build caches',
          'Gradle caches and the Maven local repository',
          'pip, uv, Poetry, conda packages, and __pycache__',
          'Hugging Face and PyTorch model caches, often the largest single item',
          'Docker data, BuildX cache, kubectl and cloud CLI caches',
        ],
      },
    ],
    workflow: [
      {
        title: 'Scan without a blocking wait',
        body: 'Sizing a toolchain means walking a lot of small files. The scan runs off the interface thread, so results fill in while you keep working instead of freezing on a spinner.',
      },
      {
        title: 'Sort by what actually costs you',
        body: 'A model cache can be larger than every node_modules on the machine combined. Targets are ranked by size, so the first row is usually the only one you need.',
      },
      {
        title: 'Review before anything is removed',
        body: 'Each target shows its path, its size, and what regenerates it. Nothing is cleared until you select it, and source directories are never a target.',
      },
    ],
    features: ['quick-clean', 'disk-analyzer', 'process-monitor', 'software-updates'],
  },
  {
    slug: 'creative-pros',
    name: 'Creative Pros',
    shortName: 'Creative',
    headline: 'Render caches grow forever. Clear them between projects.',
    summary: 'Clear media caches, render files, and previews that editing apps keep long after a project ships.',
    description: 'Video and design tools write cache aggressively and delete it rarely. SystemCleaner surfaces the media caches, render files, and previews that Final Cut, DaVinci Resolve, Adobe apps, Figma, Sketch, and Blender leave behind, so a finished project stops costing you storage.',
    icon: 'wand-stars',
    metric: 'Per project',
    detail: 'Clear caches between projects instead of buying another external drive.',
    reclaims: [
      {
        title: 'Video and motion',
        items: [
          'Final Cut Pro render cache',
          'DaVinci Resolve cache',
          'Adobe Common Media Cache files',
          'IINA and VLC playback caches',
        ],
      },
      {
        title: 'Design and 3D',
        items: [
          'Adobe Creative Cloud app caches and logs',
          'Figma desktop file cache',
          'Sketch document and application support caches',
          'Blender cache',
        ],
      },
      {
        title: 'System-side weight',
        items: [
          'QuickLook thumbnail cache for large media libraries',
          'Application logs and crash reports from long exports',
          'Trash, which holds full-size media until emptied',
        ],
      },
    ],
    workflow: [
      {
        title: 'Find the drive hog first',
        body: 'The disk map sizes folders by worker, so a scratch directory or an old export folder shows up as a single large block instead of a thousand files.',
      },
      {
        title: 'Keep the project, drop the cache',
        body: 'Cache targets are separate from your libraries and project files. Clearing a render cache costs you a re-render, not an edit.',
      },
      {
        title: 'Watch the machine during export',
        body: 'System Health and Process Monitor show CPU, memory, and GPU pressure while an export runs, so you can tell a slow render from a swap problem.',
      },
    ],
    features: ['disk-analyzer', 'quick-clean', 'system-health', 'process-monitor'],
  },
  {
    slug: 'gamers',
    name: 'Gamers',
    shortName: 'Gaming',
    headline: 'Shader caches and dead launchers, cleared.',
    summary: 'Recover space from launcher caches, compiled shaders, and games you stopped playing.',
    description: 'Game launchers keep downloads, web caches, and compiled shaders around indefinitely, and an uninstalled game usually leaves its support folder behind. SystemCleaner sizes all of it and shows you what is left over from titles that are no longer installed.',
    icon: 'gamecontroller-fill',
    metric: 'Rebuilds on launch',
    detail: 'Shader and launcher caches are regenerated the next time you play.',
    reclaims: [
      {
        title: 'Launchers',
        items: [
          'Steam client, web, and app caches',
          'Steam compiled shader cache',
          'Epic Games Launcher cache',
          'Battle.net client and app caches',
        ],
      },
      {
        title: 'Games and logs',
        items: [
          'Minecraft logs and crash reports',
          'Steam log files',
          'Game data left behind by titles you removed',
        ],
      },
      {
        title: 'The rest of the machine',
        items: [
          'Orphaned app support folders from uninstalled games',
          'GPU and shader caches under Library/Caches',
          'Trash, where a removed game can sit at full size',
        ],
      },
    ],
    workflow: [
      {
        title: 'See where the install actually went',
        body: 'The disk map walks the library folders games use, so a 90 GB install shows up as one entry rather than being buried in a tree.',
      },
      {
        title: 'Clear caches, keep saves',
        body: 'Shader and launcher caches are separate targets from save data and configuration. Clearing them costs a slightly slower first launch.',
      },
      {
        title: 'Check what is running before you play',
        body: 'Process Monitor shows what is holding CPU and memory, and Startup Items shows which launchers added themselves to login.',
      },
    ],
    features: ['disk-analyzer', 'quick-clean', 'startup-items', 'system-health'],
  },
  {
    slug: 'students',
    name: 'Students',
    shortName: 'Students',
    headline: 'A 256 GB MacBook can last the whole degree.',
    summary: 'Free space on a small SSD without deleting coursework or paying for iCloud storage.',
    description: 'The base-model Mac fills up faster than anything else, and "Other" in Storage Settings never explains why. SystemCleaner shows the actual folders taking the space, clears the caches that macOS and your apps rebuild anyway, and does it without an account or a subscription.',
    icon: 'book-fill',
    metric: 'Free and local',
    detail: 'No account, no subscription, and nothing uploaded to justify a plan.',
    reclaims: [
      {
        title: 'The usual suspects on a full Mac',
        items: [
          'User caches under Library/Caches',
          'iOS device backups, frequently the single largest folder',
          'Downloaded iOS software updates',
          'Mail attachments and old Mail downloads',
          'Trash',
        ],
      },
      {
        title: 'Browsers and apps',
        items: [
          'Chrome, Safari, Firefox, Edge, Brave, and Arc caches',
          'Spotify, Apple Music, and Podcasts offline caches',
          'Slack, Discord, Teams, and Zoom caches',
          'Notion and Obsidian caches',
        ],
      },
      {
        title: 'Leftovers',
        items: [
          'Saved application state',
          'Application logs and crash reports',
          'Support folders from apps you already deleted',
        ],
      },
    ],
    workflow: [
      {
        title: 'Answer "what is Other?"',
        body: 'The disk map names the folders that Storage Settings groups into an unhelpful category, so you can see the cause instead of guessing.',
      },
      {
        title: 'Clear the safe list first',
        body: 'Caches, logs, and saved state are marked as rebuildable. Starting there usually recovers enough space to keep working.',
      },
      {
        title: 'Nothing goes anywhere',
        body: 'There is no cloud scan and no upload step, so your notes, essays, and photos stay on the machine you are sitting at.',
      },
    ],
    features: ['disk-analyzer', 'quick-clean', 'system-health', 'software-updates'],
  },
  {
    slug: 'privacy-first',
    name: 'Privacy-First Users',
    shortName: 'Privacy',
    headline: 'A maintenance tool that does not phone home.',
    summary: 'Audit extensions, launch agents, and browser data on a machine that never reports to anyone.',
    description: 'Most cleaners want an account, an analytics pipeline, and a subscription. SystemCleaner wants none of them. It runs locally, reads only what it shows you, and gives you an inventory of the things that quietly run on your Mac: browser extensions, launch agents, and daemons.',
    icon: 'lock-shield-fill',
    metric: 'Zero telemetry',
    detail: 'No account, no analytics script, no crash reporter, no advertising identifier.',
    reclaims: [
      {
        title: 'What you can audit',
        items: [
          'Browser extensions across every profile and browser',
          'Launch agents and daemons, split by user, system, and daemon location',
          'Login items that apps added without asking',
          'Processes currently running, with owner and resource use',
        ],
      },
      {
        title: 'What you can clear',
        items: [
          'Browser caches, cookies, and site data, per browser',
          'Recent items lists for apps, documents, and servers',
          'Application logs and crash reports',
          'Orphaned data from apps that are no longer installed',
        ],
      },
      {
        title: 'What the app never does',
        items: [
          'Upload a file list, a scan result, or a system profile',
          'Require an account or a license check',
          'Load an analytics script on the app or this site',
        ],
      },
    ],
    workflow: [
      {
        title: 'Read the inventory',
        body: 'Extension Audit and Startup Items answer what is installed and what launches, in one place, without asking a server.',
      },
      {
        title: 'Decide per item',
        body: 'Removal is opt-in and path-guarded. Startup actions are limited to the known launch-item locations, so nothing outside them is touched.',
      },
      {
        title: 'Verify the claim yourself',
        body: 'The app is open source, and the cleanup code lists its target directories explicitly rather than globbing your disk. Every network call is readable in the repository.',
      },
    ],
    features: ['extension-audit', 'startup-items', 'process-monitor', 'quick-clean'],
  },
]

export function useCaseBySlug(slug: string): MarketingUseCase | undefined {
  return USE_CASES.find(useCase => useCase.slug === slug)
}
