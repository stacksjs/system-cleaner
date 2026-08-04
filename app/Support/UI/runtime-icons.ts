/**
 * Icon classes that only ever reach the DOM through a `:class` binding.
 *
 * Clean targets, disk categories, browser profiles, and startup vendors all
 * carry their glyph as data, so Crosswind's content scanner never sees the
 * class in a template and purges it. The row then renders a blank gap where
 * the icon should be. Listing them here safelists the utilities.
 *
 * Keep this in step with:
 *   - `packages/clean/src/categories.ts`   (CATEGORY_ICONS)
 *   - `packages/clean/src/browser.ts`      (browserIcon)
 *   - `packages/disk/src/categories.ts`    (FILE_CATEGORIES)
 *   - `packages/uninstall/src/discover.ts` (VENDOR_MAP)
 *
 * `tests/runtime-icons.test.ts` fails if any of those ship a class that is
 * missing from this list.
 */
export const RUNTIME_ICON_CLASSES: string[] = [
  // Clean-target categories
  'i-f7-archivebox-fill',
  'i-f7-doc-text-fill',
  'i-f7-globe',
  'i-f7-chevron-left-slash-chevron-right',
  'i-f7-cube-box-fill',
  'i-f7-app-fill',
  'i-f7-desktopcomputer',
  'i-f7-trash-fill',

  // Disk file categories
  'i-f7-largecircle-fill-circle',
  'i-f7-film-fill',
  'i-f7-music-note-2',
  'i-f7-photo-fill',
  'i-f7-doc-fill',
  'i-f7-tray-2-fill',
  'i-f7-hammer-fill',
  'i-f7-folder-fill',

  // Browser profiles
  'i-f7-flame-fill',
  'i-f7-compass-fill',
  'i-f7-shield-lefthalf-fill',
  'i-f7-circle-grid-hex-fill',

  // Startup vendors
  'i-f7-logo-apple',
  'i-f7-logo-windows',
  'i-f7-logo-google',
  'i-f7-logo-github',
  'i-f7-paintbrush-fill',
  'i-f7-cube-fill',
  'i-f7-wrench-fill',
  'i-f7-number',
  'i-f7-videocam-fill',
  'i-f7-lock-fill',
  'i-f7-bolt-fill',
  'i-f7-gamecontroller-fill',
  'i-f7-list-bullet',
  'i-f7-gear-alt-fill',

  // Toast states, bound by `:class` from the toast type
  'i-f7-checkmark-alt-circle-fill',
  'i-f7-xmark-circle-fill',
  'i-f7-exclamationmark-triangle-fill',
]
