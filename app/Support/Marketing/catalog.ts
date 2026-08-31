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
    slug: 'app-uninstaller',
    name: 'App Uninstaller',
    shortName: 'Uninstall',
    summary: 'Remove an app and the preferences, caches and launch agents dragging it to the Trash leaves behind.',
    description: 'Dragging an app to the Trash removes the bundle and nothing else. The Uninstaller finds every leftover, sizes it, and lets you keep the ones that matter before anything is removed.',
    icon: 'bin-xmark-fill',
    metric: 'Review first',
    detail: 'Every leftover is listed with its size and can be kept.',
  },
  {
    slug: 'privacy-cleanup',
    name: 'Privacy Cleanup',
    shortName: 'Privacy',
    summary: 'Clear history, cookies and site data across every browser, while staying signed in where you want to.',
    description: 'A keep-list is what makes clearing cookies something you will actually do: the sites you name survive every clear, so signing out of everything is no longer the price of a clean browser.',
    icon: 'eye-slash-fill',
    metric: 'Keep-list aware',
    detail: 'Named sites keep their cookies through every clear.',
  },
  {
    slug: 'duplicate-finder',
    name: 'Duplicate Finder',
    shortName: 'Duplicates',
    summary: 'Find files that are identical byte for byte, not merely similarly named, and keep one of each.',
    description: 'Three passes, cheapest first: size, then head and tail, then a full content hash of whatever survives both. Only the last pass decides, so nothing is called a duplicate on a guess.',
    icon: 'square-on-square',
    metric: 'Hash verified',
    detail: 'Every group is confirmed by a full content hash.',
  },
  {
    slug: 'mac-maintenance',
    name: 'Mac Maintenance',
    shortName: 'Maintenance',
    summary: 'Rebuild the caches and restart the services behind the things macOS quietly gets stuck on.',
    description: 'Each task is named for what it fixes rather than what it does, so the Open With menu full of apps you deleted leads you to the task that repairs it.',
    icon: 'wrench-fill',
    metric: 'Explained',
    detail: 'Every task says what you will notice afterwards.',
  },
  {
    slug: 'scheduled-cleaning',
    name: 'Scheduled Cleaning',
    shortName: 'Schedule',
    summary: 'Clean on a schedule that runs whether or not the app is open, and catches up after sleep.',
    description: 'The schedule is a launch agent rather than a timer inside the app, because the app is not running at 3am. If the Mac was asleep, the clean runs when it next wakes instead of being skipped.',
    icon: 'clock-fill',
    metric: 'Runs closed',
    detail: 'launchd fires the clean with the app shut.',
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
    summary: 'Find browser extensions across every profile, see what they can reach, and remove the ones you do not want.',
    description: 'Extension Audit brings scattered browser add-ons into one place with their size and permission count, and removes them — telling you plainly which ones a sync account could bring back, and which are gone for good.',
    icon: 'square-stack-3d-up-fill',
    metric: 'One inventory',
    detail: 'Every profile and browser in one removable list.',
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
