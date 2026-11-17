import type { Section } from '../../../resources/lib/sections'
import { SECTIONS } from '../../../resources/lib/sections'

export interface MarketingFeature {
  slug: string
  /**
   * The app section this tool lives in. The site groups and colours every
   * feature by it, so the website and the app's sidebar describe the same
   * five places in the same order.
   */
  section: Section['id']
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
    section: 'cleanup',
    name: 'Quick Clean',
    shortName: 'Clean',
    summary: 'Clear the caches, logs, browser data and stale files that are safe to remove, after you have seen each one.',
    description: 'Quick Clean measures the caches and logs that macOS and your apps leave behind, then lists every folder with its size. Nothing is removed until you have looked at the list and chosen.',
    icon: 'sparkles',
    metric: 'Review first',
    detail: 'You see every folder and its size before anything is removed.',
  },
  {
    slug: 'disk-analyzer',
    section: 'storage',
    name: 'Disk Analyzer',
    shortName: 'Analyze',
    summary: 'See which folders and files take the most space, and keep working while the scan runs.',
    description: 'The scan runs in the background and maps your disk folder by folder, so you can open the biggest ones and see what is inside while it measures the rest.',
    icon: 'chart-pie-fill',
    metric: 'Stays responsive',
    detail: 'The window never freezes while the disk is being measured.',
  },
  {
    slug: 'app-uninstaller',
    section: 'apps',
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
    section: 'protection',
    name: 'Privacy Cleanup',
    shortName: 'Privacy',
    summary: 'Clear history, cookies and site data across every browser, while staying signed in where you want to.',
    description: 'Name the sites you want to stay signed in to and their cookies survive every clear, so a clean browser no longer means signing in to everything again.',
    icon: 'eye-slash-fill',
    metric: 'Keeps your sign-ins',
    detail: 'Named sites keep their cookies through every clear.',
  },
  {
    slug: 'duplicate-finder',
    section: 'storage',
    name: 'Duplicate Finder',
    shortName: 'Duplicates',
    summary: 'Find files that are identical byte for byte, whatever they are called, and keep one of each.',
    description: 'Three passes, cheapest first: size, then head and tail, then a full content hash of whatever survives both. Only the last pass decides, so nothing is called a duplicate on a guess.',
    icon: 'square-on-square',
    metric: 'Hash verified',
    detail: 'Every group is confirmed by a full content hash.',
  },
  {
    slug: 'mac-maintenance',
    section: 'performance',
    name: 'Mac Maintenance',
    shortName: 'Maintenance',
    summary: 'Rebuild the caches and restart the services behind the things macOS quietly gets stuck on.',
    description: 'Each task is named for the problem it fixes, so an Open With menu full of apps you deleted leads you straight to the task that repairs it.',
    icon: 'wrench-fill',
    metric: 'Explained',
    detail: 'Every task says what you will notice afterwards.',
  },
  {
    slug: 'scheduled-cleaning',
    section: 'cleanup',
    name: 'Scheduled Cleaning',
    shortName: 'Schedule',
    summary: 'Clean on a schedule that runs whether or not the app is open, and catches up after sleep.',
    description: 'The schedule is a launch agent rather than a timer inside the app, because the app is not running at 3am. If the Mac was asleep, the clean runs when it next wakes instead of being skipped.',
    icon: 'clock-fill',
    metric: 'Runs closed',
    detail: 'macOS starts the clean even when the app is closed.',
  },
  {
    slug: 'startup-items',
    section: 'performance',
    name: 'Startup Items',
    shortName: 'Startup',
    summary: 'See what launches with your Mac, then turn off or remove only what you recognize.',
    description: 'Startup Items lists everything that opens at login or runs in the background, sorted into your own items, items for every account and system daemons, so you know whose each one is before you touch it.',
    icon: 'bolt-fill',
    metric: 'Known places only',
    detail: 'It changes items only in the standard folders macOS launches from.',
  },
  {
    slug: 'process-monitor',
    section: 'performance',
    name: 'Process Monitor',
    shortName: 'Processes',
    summary: 'See which processes are using the CPU and memory right now.',
    description: 'A live list of what is running, with the CPU, memory and owner of each process, and safeguards on quitting one.',
    icon: 'chart-bar-alt-fill',
    metric: 'Live',
    detail: 'The list keeps up with the Mac without adding load of its own.',
  },
  {
    slug: 'extension-audit',
    section: 'apps',
    name: 'Extension Audit',
    shortName: 'Extensions',
    summary: 'Find browser extensions across every profile, see what they can reach, and remove the ones you do not want.',
    description: 'Every extension from every browser profile in one list, with its size and how many permissions it holds. When you remove one, it tells you whether your browser sync could bring it back.',
    icon: 'square-stack-3d-up-fill',
    metric: 'One inventory',
    detail: 'Every profile and browser in one removable list.',
  },
  {
    slug: 'software-updates',
    section: 'apps',
    name: 'Software Updates',
    shortName: 'Updates',
    summary: 'Check macOS, your apps, Homebrew and Pantry for updates in one list.',
    description: 'Update checks run in the background and remember their answer for a short while, so opening SystemCleaner never waits on Homebrew or Pantry.',
    icon: 'arrow-down-circle-fill',
    metric: 'Never in the way',
    detail: 'Checking for updates never delays the window.',
  },
  {
    slug: 'system-health',
    section: 'performance',
    name: 'System Health',
    shortName: 'Health',
    summary: 'Read CPU, memory, battery, network, GPU and disk at a glance.',
    description: 'System Health puts the readings you check most on one page, and opens the detail when one of them needs a look.',
    icon: 'heart-fill',
    metric: 'Local only',
    detail: 'Health metrics stay on the Mac where they were measured.',
  },
]

export function featureBySlug(slug: string): MarketingFeature | undefined {
  return FEATURES.find(feature => feature.slug === slug)
}

/** A section of the app, with the marketing features that live in it. */
export interface MarketingSection {
  id: Section['id']
  label: string
  icon: string
  headline: string
  lede: string
  /** Every tool the app lists in this section, by its in-app label. */
  tools: string[]
  features: MarketingFeature[]
  /** The section page, photographed from the app, under `/images/showcase`. */
  image: string
}

/**
 * The app's sections in sidebar order, Overview aside, each carrying the
 * features that belong to it. Read from the same table the app's sidebar
 * reads, so a renamed or reordered section changes here too.
 */
export const MARKETING_SECTIONS: MarketingSection[] = SECTIONS
  .filter(section => section.id !== 'overview')
  .map(section => ({
    id: section.id,
    label: section.label,
    icon: section.icon,
    headline: section.headline,
    lede: section.lede,
    tools: section.tools.map(tool => tool.label),
    features: FEATURES.filter(feature => feature.section === section.id),
    image: `/images/showcase/${section.id}.jpg`,
  }))

export function sectionOf(feature: MarketingFeature): MarketingSection {
  return MARKETING_SECTIONS.find(section => section.id === feature.section) || MARKETING_SECTIONS[0]
}
