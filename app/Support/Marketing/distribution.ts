/**
 * Where the marketing site sends people to get the app.
 *
 * Everything that renders a download, source, or store link reads from here
 * so the nav, hero, download band, and footer can never drift apart.
 */

/** Direct download. Points at the newest tagged build produced by the release workflow. */
export const DOWNLOAD_URL = 'https://github.com/stacksjs/system-cleaner/releases/latest'

/**
 * The Mac App Store listing, once there is one.
 *
 * Empty until the listing is live, and every store button is drawn only when
 * this is set. The placeholder it replaced sent people to an App Store search
 * that found nothing, which reads as a broken link on the one button that
 * most needs to work. Set it to `https://apps.apple.com/app/id<APP_ID>` and
 * the buttons appear in the hero, the download band and the footer together.
 */
export const MAC_APP_STORE_URL: string = ''

/** Public repository, used by the "View source" action. */
export const SOURCE_URL = 'https://github.com/stacksjs/system-cleaner'

/**
 * Shown under the download actions so the requirement is stated before the
 * click. Apple silicon only, matching what `scripts/build-binaries.ts` can
 * actually produce: Bun stopped shipping a darwin-x64 runtime in 1.4.
 */
export const SYSTEM_REQUIREMENT = 'macOS 14 Sonoma or later. Apple silicon.'
