/**
 * Where the marketing site sends people to get the app.
 *
 * Everything that renders a download, source, or store link reads from here
 * so the nav, hero, download band, and footer can never drift apart.
 */

/** Direct download. Points at the newest tagged build produced by the release workflow. */
export const DOWNLOAD_URL = 'https://github.com/stacksjs/system-cleaner/releases/latest'

/**
 * Mac App Store listing.
 *
 * TODO: replace with the product URL (`https://apps.apple.com/app/id<APP_ID>`)
 * once the listing is live. Until then this is a real, working Apple URL
 * rather than a fabricated product id that would 404.
 */
export const MAC_APP_STORE_URL = 'https://apps.apple.com/search?term=SystemCleaner'

/** Public repository, used by the "View source" action. */
export const SOURCE_URL = 'https://github.com/stacksjs/system-cleaner'

/**
 * Shown under the download actions so the requirement is stated before the
 * click. Apple silicon only, matching what `scripts/build-binaries.ts` can
 * actually produce: Bun stopped shipping a darwin-x64 runtime in 1.4.
 */
export const SYSTEM_REQUIREMENT = 'macOS 14 Sonoma or later. Apple silicon.'
