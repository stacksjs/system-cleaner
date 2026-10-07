import type { FileCategory } from './types'

interface CategoryDefinition {
  category: FileCategory
  label: string
  icon: string
  color: string
  extensions: string[]
}

const FILE_CATEGORIES: CategoryDefinition[] = [
  {
    category: 'archive',
    label: 'Archives',
    icon: 'i-f7-cube-box-fill',
    color: '#ff9f0a',
    extensions: ['.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar', '.tgz', '.zst', '.lz4'],
  },
  {
    category: 'disk-image',
    label: 'Disk Images',
    icon: 'i-f7-largecircle-fill-circle',
    color: '#bf5af2',
    extensions: ['.dmg', '.iso', '.img', '.sparseimage', '.sparsebundle', '.vmdk', '.vdi', '.qcow2'],
  },
  {
    category: 'video',
    label: 'Videos',
    icon: 'i-f7-film-fill',
    color: '#ff375f',
    extensions: ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.3gp'],
  },
  {
    category: 'audio',
    label: 'Audio',
    icon: 'i-f7-music-note-2',
    color: '#ff453a',
    extensions: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.aiff', '.opus', '.alac'],
  },
  {
    category: 'image',
    label: 'Images',
    icon: 'i-f7-photo-fill',
    color: '#30d158',
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp', '.heic', '.heif', '.svg', '.ico', '.raw', '.cr2', '.nef', '.psd', '.ai'],
  },
  {
    category: 'document',
    label: 'Documents',
    icon: 'i-f7-doc-fill',
    color: '#0a84ff',
    extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pages', '.numbers', '.keynote', '.txt', '.rtf', '.csv', '.odt', '.ods', '.odp', '.epub'],
  },
  {
    category: 'database',
    label: 'Databases',
    icon: 'i-f7-tray-2-fill',
    color: '#5e5ce6',
    extensions: ['.db', '.sqlite', '.sqlite3', '.realm', '.mdb', '.accdb'],
  },
  {
    category: 'code',
    label: 'Source Code',
    icon: 'i-f7-desktopcomputer',
    color: '#64d2ff',
    extensions: ['.ts', '.js', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.cs', '.php', '.vue', '.stx', '.svelte'],
  },
  {
    category: 'build-artifact',
    label: 'Build Artifacts',
    icon: 'i-f7-hammer-fill',
    color: '#ffd60a',
    extensions: ['.o', '.obj', '.a', '.lib', '.so', '.dylib', '.dll', '.class', '.pyc', '.wasm', '.dSYM'],
  },
  {
    category: 'package-cache',
    label: 'Package Caches',
    icon: 'i-f7-cube-box-fill',
    color: '#ff9f0a',
    extensions: ['.tgz', '.gem', '.whl', '.egg', '.jar', '.war', '.aar'],
  },
  {
    category: 'log',
    label: 'Log Files',
    icon: 'i-f7-doc-text-fill',
    color: '#98989d',
    extensions: ['.log', '.log.gz', '.crash', '.ips', '.diag'],
  },
]

const extensionMap = new Map<string, FileCategory>()
for (const cat of FILE_CATEGORIES) {
  for (const ext of cat.extensions)
    extensionMap.set(ext, cat.category)
}

/**
 * Categorize a file by its extension
 */
export function categorizeFile(filename: string): FileCategory {
  const dotIdx = filename.lastIndexOf('.')
  if (dotIdx === -1 || dotIdx === 0)
    return 'other'
  const ext = filename.substring(dotIdx).toLowerCase()
  return extensionMap.get(ext) || 'other'
}

/**
 * Get category info by category name
 */
export function getCategoryInfo(category: FileCategory): CategoryDefinition | undefined {
  return FILE_CATEGORIES.find(c => c.category === category)
}

/**
 * Get all category definitions
 */
export function getAllCategories(): CategoryDefinition[] {
  return FILE_CATEGORIES
}

// ── Project Artifact Detection ─────────────────────────────────

/**
 * Directories a build regenerates, keyed by exact name.
 *
 * `safe` comes back from a command and a network round-trip with nothing a
 * person wrote inside it. `caution` is for the ones that look identical and
 * are not: `dist` and `build` can hold the output a release was cut from with
 * nothing proving it reproduces, `vendor` is exactly what an offline Go or PHP
 * build needs, and a virtualenv can carry compiled extensions that cost real
 * minutes to rebuild. Nothing stops you cleaning a `caution` entry — Select
 * All just leaves it alone, the same rule `CleanTarget.risk` already uses.
 */
const PROJECT_ARTIFACT_PATTERNS: { dirName: string, type: string, label: string, risk: 'safe' | 'caution' }[] = [
  { dirName: 'node_modules', type: 'JavaScript', label: 'Node.js dependencies', risk: 'safe' },
  { dirName: 'target', type: 'Rust/Java', label: 'Compiled output', risk: 'safe' },
  { dirName: '.zig-cache', type: 'Zig', label: 'Zig build cache', risk: 'safe' },
  { dirName: 'zig-cache', type: 'Zig', label: 'Zig build cache (legacy layout)', risk: 'safe' },
  { dirName: 'zig-out', type: 'Zig', label: 'Zig build output', risk: 'safe' },
  { dirName: 'build', type: 'Generic', label: 'Build output', risk: 'caution' },
  { dirName: 'dist', type: 'Generic', label: 'Distribution output', risk: 'caution' },
  { dirName: '.next', type: 'Next.js', label: 'Next.js build cache', risk: 'safe' },
  { dirName: '__pycache__', type: 'Python', label: 'Python bytecode cache', risk: 'safe' },
  { dirName: '.venv', type: 'Python', label: 'Python virtual environment', risk: 'caution' },
  { dirName: 'venv', type: 'Python', label: 'Python virtual environment', risk: 'caution' },
  { dirName: 'vendor', type: 'Go/PHP', label: 'Vendored dependencies', risk: 'caution' },
  { dirName: '.nuxt', type: 'Nuxt', label: 'Nuxt.js build cache', risk: 'safe' },
  { dirName: '.svelte-kit', type: 'SvelteKit', label: 'SvelteKit build output', risk: 'safe' },
  { dirName: '.turbo', type: 'Turbo', label: 'Turborepo cache', risk: 'safe' },
  { dirName: '.parcel-cache', type: 'Parcel', label: 'Parcel bundler cache', risk: 'safe' },
  { dirName: '.stx', type: 'STX', label: 'STX build output', risk: 'safe' },
  { dirName: '.gradle', type: 'Gradle', label: 'Gradle build cache', risk: 'safe' },
  { dirName: 'Pods', type: 'CocoaPods', label: 'CocoaPods dependencies', risk: 'safe' },
  { dirName: '.dart_tool', type: 'Dart', label: 'Dart tool cache', risk: 'safe' },
  { dirName: '.angular', type: 'Angular', label: 'Angular build cache', risk: 'safe' },

  // Everything below came from auditing a working developer Mac where the list
  // above found 23.4 GB and walked past more than half of what was there.
  // `pantry` alone held 12 GB across 27 projects — more than any other kind.
  { dirName: 'pantry', type: 'Pantry', label: 'Vendored system runtimes', risk: 'safe' },
  { dirName: '.mypy_cache', type: 'Python', label: 'mypy type cache', risk: 'safe' },
  { dirName: '.pytest_cache', type: 'Python', label: 'pytest cache', risk: 'safe' },
  { dirName: '.ruff_cache', type: 'Python', label: 'Ruff cache', risk: 'safe' },
  { dirName: '.tox', type: 'Python', label: 'tox environments', risk: 'safe' },
  { dirName: '.terraform', type: 'Terraform', label: 'Downloaded provider plugins', risk: 'safe' },
  { dirName: '.astro', type: 'Astro', label: 'Astro build cache', risk: 'safe' },
  { dirName: '.vercel', type: 'Vercel', label: 'Vercel build output', risk: 'safe' },
  { dirName: '.output', type: 'Nitro', label: 'Nitro build output', risk: 'safe' },
  { dirName: 'DerivedData', type: 'Xcode', label: 'Per-project derived data', risk: 'safe' },
  { dirName: 'Carthage', type: 'Carthage', label: 'Carthage dependencies', risk: 'safe' },
  { dirName: '.nyc_output', type: 'Coverage', label: 'Coverage intermediate output', risk: 'safe' },
  { dirName: 'coverage', type: 'Coverage', label: 'Coverage report', risk: 'safe' },
]

/**
 * Check if a directory name is a known project artifact
 */
export function isProjectArtifact(dirName: string): { isArtifact: boolean, type?: string, label?: string, risk?: 'safe' | 'caution' } {
  const match = PROJECT_ARTIFACT_PATTERNS.find(p => p.dirName === dirName)
  if (match)
    return { isArtifact: true, type: match.type, label: match.label, risk: match.risk }
  return { isArtifact: false }
}

/**
 * Get all known project artifact patterns
 */
export function getProjectArtifactPatterns(): typeof PROJECT_ARTIFACT_PATTERNS {
  return PROJECT_ARTIFACT_PATTERNS
}

/**
 * Presentation for a category, including the `other` bucket.
 *
 * `getCategoryInfo` returns `undefined` for `other` because there is no
 * definition for it — every caller then reinvented the same fallback label,
 * glyph, and colour. This is that fallback, in one place.
 */
export function categoryPresentation(category: FileCategory): { label: string, icon: string, color: string } {
  const info = getCategoryInfo(category)
  if (info)
    return { label: info.label, icon: info.icon, color: info.color }

  return { label: 'Other Files', icon: 'i-f7-folder-fill', color: '#98989d' }
}
