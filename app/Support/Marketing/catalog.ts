export interface MarketingFeature {
  slug: string
  name: string
  shortName: string
  summary: string
  description: string
  icon: string
  metric: string
  detail: string
}

export const FEATURES: MarketingFeature[] = [
  {
    slug: 'quick-clean',
    name: 'Quick Clean',
    shortName: 'Clean',
    summary: 'Clear safe caches, logs, browser data, and stale files with a review-first workflow.',
    description: 'SystemCleaner finds reclaimable files across macOS and the apps you use, then shows every target before anything leaves your Mac.',
    icon: 'sparkles',
    metric: 'Review first',
    detail: 'Every cleanup target is visible before removal.',
  },
  {
    slug: 'disk-analyzer',
    name: 'Disk Analyzer',
    shortName: 'Analyze',
    summary: 'See which folders and files are using space without waiting on a blocking scan.',
    description: 'A worker-backed disk scan maps storage by folder, keeps the interface responsive, and lets you inspect large items in context.',
    icon: 'chart-pie-fill',
    metric: 'Worker backed',
    detail: 'Heavy filesystem work stays off the interface thread.',
  },
  {
    slug: 'startup-items',
    name: 'Startup Items',
    shortName: 'Startup',
    summary: 'Inspect launch agents and daemons, then disable or remove only what you recognize.',
    description: 'Startup Items explains what launches with your Mac and keeps user, system, and daemon locations clearly separated.',
    icon: 'bolt-fill',
    metric: 'Path guarded',
    detail: 'Actions are limited to known launch-item locations.',
  },
  {
    slug: 'process-monitor',
    name: 'Process Monitor',
    shortName: 'Processes',
    summary: 'Track CPU and memory use with a focused view of the processes that matter now.',
    description: 'Live process data stays compact and readable, with clear CPU, memory, and ownership details plus guarded termination controls.',
    icon: 'chart-bar-alt-fill',
    metric: 'Live view',
    detail: 'Fast refreshes use cached summaries and compact payloads.',
  },
  {
    slug: 'extension-audit',
    name: 'Extension Audit',
    shortName: 'Extensions',
    summary: 'Find browser extensions across profiles and spot old or unexpected installs.',
    description: 'Extension Audit brings scattered browser add-ons into one place so you can understand what is installed and where it came from.',
    icon: 'square-stack-3d-up-fill',
    metric: 'One inventory',
    detail: 'Profiles and browsers are normalized into one view.',
  },
  {
    slug: 'software-updates',
    name: 'Software Updates',
    shortName: 'Updates',
    summary: 'Check macOS, Homebrew, and Pantry updates from one responsive queue.',
    description: 'Update checks run outside page rendering and reuse short-lived caches, so opening SystemCleaner never waits on package managers.',
    icon: 'arrow-down-circle-fill',
    metric: 'Nonblocking',
    detail: 'Package checks never hold up the first paint.',
  },
  {
    slug: 'system-health',
    name: 'System Health',
    shortName: 'Health',
    summary: 'Read CPU, memory, battery, network, GPU, and disk signals without a crowded dashboard.',
    description: 'System Health turns the Mac metrics you actually need into one calm overview, with detail available when a signal needs attention.',
    icon: 'heart-fill',
    metric: 'Local only',
    detail: 'Health metrics stay on the Mac where they were measured.',
  },
]

export function featureBySlug(slug: string): MarketingFeature | undefined {
  return FEATURES.find(feature => feature.slug === slug)
}
