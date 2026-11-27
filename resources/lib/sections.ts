/**
 * The app's map: six sections, and the tools inside each one.
 *
 * The sidebar lists sections only. Clicking one opens that section's own page,
 * which presents its tools as cards, so the sidebar stays a short list of
 * places and never turns back into a wall of icons. The sidebar, the toolbar's
 * breadcrumb, the section pages and the Go menu all read this one table, so a
 * tool moved here moves everywhere at once.
 *
 * Plain data on purpose: it is imported by STX server scripts and by the
 * browser bundles in `resources/scripts`, so it may import nothing.
 */

export type Tone = 'overview' | 'cleanup' | 'storage' | 'performance' | 'apps' | 'protection'

export interface Tool {
  /** The `@section('nav', …)` id the tool's view declares. */
  id: string
  label: string
  href: string
  icon: string
  description: string
  /** A live figure the card can show, filled by `hub-metrics.ts`. */
  metric?: string
  /** The sentence the figure goes into on the card, `{value}` for the figure. */
  metricTemplate?: string
  /** The `/api/scan-state` kinds that belong to this tool. */
  scans?: string[]
}

/**
 * A live panel under a section page's tool cards. `hub-metrics.ts` owns how
 * each id is drawn; this says which ones a section shows, in what order.
 */
export interface Panel {
  id: string
  title: string
  /**
   * Where the panel's header link goes. Left off when the page's round button
   * already goes there, so no page offers the same action twice.
   */
  link?: { label: string, href: string }
}

export interface Section {
  id: Tone
  label: string
  href: string
  icon: string
  /** One line under the section's hero headline. */
  lede: string
  /** The headline while its live figure is loading, and if it never arrives. */
  headline: string
  /**
   * The live headline, with `{value}` standing in for the metric. `whenClear`
   * replaces the whole sentence when the figure is the all-clear value.
   */
  headlineMetric?: { metric: string, template: string, whenClear?: string }
  /** The round button: the tool most people came for. `short` fits inside it. */
  primary?: { label: string, short: string, href: string }
  tools: Tool[]
  panels?: Panel[]
}

export const SECTIONS: Section[] = [
  {
    id: 'overview',
    label: 'Overview',
    href: '/app',
    icon: 'i-f7-sparkles',
    headline: 'Your Mac at a glance',
    lede: 'One look at what can be cleaned, what is taking the space, and what is slowing things down.',
    primary: { label: 'Start Quick Clean', short: 'Clean', href: '/app/cleanup' },
    tools: [
      {
        id: 'activity',
        label: 'Activity',
        href: '/app/activity',
        icon: 'i-f7-clock-fill',
        description: 'App sessions, actions and cleanup totals over time.',
      },
      {
        id: 'monitor',
        label: 'System Monitor',
        href: '/app/monitor',
        icon: 'i-f7-waveform-path-ecg',
        description: 'Live CPU, memory and disk, with the processes behind them.',
        metric: 'health',
        metricTemplate: 'Health {value}',
      },
    ],
  },
  {
    id: 'cleanup',
    label: 'Cleanup',
    href: '/app/clean',
    icon: 'i-f7-trash-fill',
    headline: 'Clear out the junk',
    headlineMetric: { metric: 'junk', template: '{value} of junk to clean' },
    lede: 'Caches, logs, build output and what uninstalled apps left behind. Everything here rebuilds itself or belongs to nothing.',
    primary: { label: 'Start Quick Clean', short: 'Clean', href: '/app/cleanup' },
    panels: [
      { id: 'cleanup-history', title: 'Recent cleanups' },
      { id: 'schedule', title: 'Scheduled clean', link: { label: 'Change', href: '/app/schedule' } },
    ],
    tools: [
      {
        id: 'cleanup',
        label: 'Quick Clean',
        href: '/app/cleanup',
        icon: 'i-f7-sparkles',
        description: 'Caches, logs and temporary files that are safe to remove.',
        metric: 'junk',
        metricTemplate: '{value} to clean',
      },
      {
        id: 'developer',
        label: 'Developer Junk',
        href: '/app/developer',
        icon: 'i-f7-chevron-left-slash-chevron-right',
        description: 'node_modules, build output and caches inside your projects.',
      },
      {
        id: 'orphans',
        label: 'Leftover Data',
        href: '/app/orphans',
        icon: 'i-f7-tray-fill',
        description: 'Support files from apps that are no longer installed.',
      },
      {
        id: 'schedule',
        label: 'Scheduled Clean',
        href: '/app/schedule',
        icon: 'i-f7-clock-fill',
        description: 'Run the safe clean on its own, overnight.',
      },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    href: '/app/storage',
    icon: 'i-f7-folder-fill',
    headline: 'See what is taking the space',
    headlineMetric: { metric: 'disk-free', template: '{value} free on your Mac' },
    lede: 'Find the big folders, the forgotten files and the copies you never meant to keep.',
    primary: { label: 'Explore Disk Usage', short: 'Explore', href: '/app/disk' },
    panels: [
      { id: 'disk', title: 'Startup disk' },
      { id: 'quick-wins', title: 'Quick wins' },
    ],
    tools: [
      {
        id: 'disk',
        label: 'Disk Usage',
        href: '/app/disk',
        icon: 'i-f7-chart-pie-fill',
        description: 'An interactive map of every folder on the disk.',
        metric: 'disk-used',
        scans: ['tree'],
      },
      {
        id: 'large-files',
        label: 'Large Files',
        href: '/app/large-files',
        icon: 'i-f7-doc-on-doc-fill',
        description: 'The biggest files in your home folder, oldest first.',
        scans: ['large-files'],
      },
      {
        id: 'duplicates',
        label: 'Duplicates',
        href: '/app/duplicates',
        icon: 'i-f7-square-on-square',
        description: 'Byte-identical copies of the same file.',
        scans: ['duplicates'],
      },
      {
        id: 'similar',
        label: 'Similar Images',
        href: '/app/similar',
        icon: 'i-f7-photo-on-rectangle',
        description: 'Photos that look the same without being the same file.',
        scans: ['similar'],
      },
    ],
  },
  {
    id: 'performance',
    label: 'Performance',
    href: '/app/performance',
    icon: 'i-f7-speedometer',
    headline: 'Keep your Mac quick',
    headlineMetric: { metric: 'startup', template: '{value} launch at login' },
    lede: 'Trim what starts with your Mac, find what is working it hard, and run the upkeep macOS skips.',
    primary: { label: 'Review Startup Items', short: 'Review', href: '/app/startup' },
    panels: [
      { id: 'gauges', title: 'Right now', link: { label: 'System Monitor', href: '/app/monitor' } },
      { id: 'processes', title: 'Busiest processes', link: { label: 'All processes', href: '/app/processes' } },
    ],
    tools: [
      {
        id: 'startup',
        label: 'Startup Items',
        href: '/app/startup',
        icon: 'i-f7-bolt-fill',
        description: 'Login items and launch agents that start with your Mac.',
        metric: 'startup',
      },
      {
        id: 'processes',
        label: 'Processes',
        href: '/app/processes',
        icon: 'i-f7-chart-bar-alt-fill',
        description: 'What is using the CPU and memory right now.',
        metric: 'memory',
      },
      {
        id: 'maintenance',
        label: 'Maintenance',
        href: '/app/maintenance',
        icon: 'i-f7-wrench-fill',
        description: 'Flush DNS, rebuild indexes and run the periodic scripts.',
      },
      {
        id: 'monitor',
        label: 'System Monitor',
        href: '/app/monitor',
        icon: 'i-f7-waveform-path-ecg',
        description: 'Live CPU, memory and disk history.',
        metric: 'health',
        metricTemplate: 'Health {value}',
      },
    ],
  },
  {
    id: 'apps',
    label: 'Applications',
    href: '/app/apps',
    icon: 'i-f7-app-fill',
    headline: 'Manage every app in one place',
    headlineMetric: { metric: 'updates', template: '{value} waiting to install', whenClear: 'Every app is up to date' },
    lede: 'Uninstall apps completely, keep the rest up to date, and clear out extensions you never meant to install.',
    primary: { label: 'Open Installed Apps', short: 'Open', href: '/app/applications' },
    panels: [
      { id: 'updates-breakdown', title: 'Updates by source', link: { label: 'Review', href: '/app/updates' } },
      { id: 'extensions', title: 'Browser extensions', link: { label: 'Manage', href: '/app/extensions' } },
    ],
    tools: [
      {
        id: 'applications',
        label: 'Installed Apps',
        href: '/app/applications',
        icon: 'i-f7-xmark-square-fill',
        description: 'Remove an app together with everything it left around.',
      },
      {
        id: 'updates',
        label: 'Updates',
        href: '/app/updates',
        icon: 'i-f7-arrow-down-circle-fill',
        description: 'macOS, Homebrew and app updates waiting to install.',
        metric: 'updates',
      },
      {
        id: 'extensions',
        label: 'Browser Extensions',
        href: '/app/extensions',
        icon: 'i-f7-square-stack-3d-up-fill',
        description: 'Browser extensions installed across your browsers.',
        metric: 'extensions',
      },
    ],
  },
  {
    id: 'protection',
    label: 'Protection',
    href: '/app/protection',
    icon: 'i-f7-checkmark-shield-fill',
    headline: 'Decide what can see you',
    headlineMetric: { metric: 'privacy', template: '{value} of browsing traces' },
    lede: 'Clear your browsing traces, review what apps were allowed to reach, and check the network you are on.',
    primary: { label: 'Clean Privacy Traces', short: 'Clean', href: '/app/privacy' },
    panels: [
      { id: 'traces', title: 'Largest browsing traces' },
      { id: 'access', title: 'App access', link: { label: 'Review', href: '/app/permissions' } },
    ],
    tools: [
      {
        id: 'privacy',
        label: 'Privacy',
        href: '/app/privacy',
        icon: 'i-f7-eye-slash-fill',
        description: 'Browser history, cookies and recent-items lists.',
        metric: 'privacy',
        metricTemplate: '{value} of traces',
      },
      {
        id: 'permissions',
        label: 'App Permissions',
        href: '/app/permissions',
        icon: 'i-f7-hand-raised-fill',
        description: 'Camera, microphone, files and more, app by app.',
        metric: 'permissions',
        metricTemplate: '{value} with access',
      },
      {
        id: 'vpn',
        label: 'VPN',
        href: '/app/vpn',
        icon: 'i-f7-lock-shield-fill',
        description: 'The state of the VPN connections on this Mac.',
      },
    ],
  },
]

export const SETTINGS_PATH = '/app/settings'

/** Command-number bindings follow the sidebar, including its utility rows. */
export const SIDEBAR_SHORTCUTS = [
  ...SECTIONS.map(({ label, href }) => ({ label, href })),
  { label: 'Activity', href: '/app/activity' },
  { label: 'Settings…', href: SETTINGS_PATH },
  { label: 'Disk Usage', href: '/app/disk' },
].map((screen, index) => ({ ...screen, key: String(index + 1) }))

/**
 * The section a page belongs to, from the `nav` id its view declares.
 *
 * Section pages declare `hub-<section>` so they can never collide with a tool:
 * Quick Clean's id is `cleanup`, which is also the Cleanup section's.
 */
export function sectionFor(navId: string): { section: Section, tool?: Tool } | undefined {
  if (navId === 'dashboard' || navId === 'hub-overview')
    return { section: SECTIONS[0] }
  if (navId.startsWith('hub-')) {
    const section = SECTIONS.find(candidate => candidate.id === navId.slice(4))
    return section ? { section } : undefined
  }
  // Overview lists System Monitor as a shortcut, but Performance owns it.
  for (const section of SECTIONS) {
    const tool = section.tools.find(candidate => candidate.id === navId && (section.id !== 'overview' || candidate.id === 'activity'))
    if (tool) return { section, tool }
  }
  return undefined
}

/** The same lookup from a URL path, for code that only has `location`. */
export function sectionForPath(pathname: string): { section: Section, tool?: Tool } | undefined {
  const path = pathname.replace(/\/+$/, '') || '/'
  for (const section of SECTIONS) {
    if (section.href === path) return { section }
  }
  for (const section of SECTIONS) {
    const tool = section.tools.find(candidate => (section.id !== 'overview' || candidate.id === 'activity')
      && (path === candidate.href || path.startsWith(`${candidate.href}/`)))
    if (tool) return { section, tool }
  }
  return undefined
}
