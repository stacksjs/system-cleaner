import type { ImagesConfig } from '@stacksjs/types'

/**
 * Generated imagery for SystemCleaner.
 *
 * Only the app icons are declared. The mark is the single source: everything
 * else — the `.icns` inside the macOS bundle, the favicons, the web manifest —
 * is derived from it by `buddy generate:app-icons`, so there is one file to
 * change when the brand does.
 */
export default {
  brand: 'SystemCleaner',
  mark: 'public/images/systemcleaner-mark.svg',

  appIcons: {
    enabled: true,
    source: 'public/images/app-icon.png',
    outputDir: 'resources/assets/images',
    platforms: ['macos'],
    favicon: true,
    faviconDir: 'public',
    manifest: {
      name: 'SystemCleaner',
      shortName: 'SystemCleaner',
      themeColor: '#0a84ff',
      backgroundColor: '#1a1a1c',
    },
  },
} satisfies ImagesConfig
