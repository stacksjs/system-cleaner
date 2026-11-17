/**
 * The Mac App Store listing, applied with:
 *
 *   pantry app-store:listing --bundle-id org.stacksjs.system-cleaner [--build-number N] [--submit]
 *
 * The review contact's phone number stays out of the repository: pass
 * APP_STORE_REVIEW_CONTACT='{"firstName":…,"lastName":…,"phone":…,"email":…}'
 * when submitting.
 */
import { readFileSync } from 'node:fs'

const description = `SystemCleaner shows you what is filling your Mac before you delete anything.

Give it your home folder once, and it sizes the caches, logs and leftovers that are safe to clear, maps where the rest of your disk went, and lists what takes up room you forgot about. Nothing is removed until you have seen it and said yes, and removed files go to the Trash, so you can change your mind.

What it does

Cleanup. Finds app caches, logs, browser data and developer leftovers, grouped by kind and sorted by size, with the path of every item shown.

Storage. An interactive map of your home folder: point at a ring to see what it holds, click to go deeper, and reveal anything in Finder.

Large files and duplicates. The biggest files in your home folder, oldest first, and byte-identical copies of the same file.

Applications. What is installed, how much room each app takes, and the support files an app leaves behind after you remove it.

Private by design

Every scan runs on your Mac. SystemCleaner has no account, no analytics, no telemetry and no crash reporter, and it sends nothing about your Mac anywhere. The app is open source, so every scan path and every delete is there to read.`

export default {
  locale: 'en-US',
  subtitle: 'See what fills your Mac',
  promotionalText: 'Find the caches, leftovers and forgotten files filling your Mac, see each one before it goes, and keep every scan on your own machine.',
  description,
  keywords: 'cleaner,disk,storage,junk,cache,space,duplicates,large files,uninstall,leftovers,cleanup',
  whatsNew: 'The first Mac App Store release of SystemCleaner.',
  marketingUrl: 'https://system-cleaner.app',
  supportUrl: 'https://github.com/stacksjs/system-cleaner/issues',
  privacyPolicyUrl: 'https://github.com/stacksjs/system-cleaner/blob/main/PRIVACY.md',
  copyright: '2026 Stacks.js',
  primaryCategory: 'UTILITIES',
  contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT',
  price: '0',
  releaseType: 'AFTER_APPROVAL',
  availableInNewTerritories: true,
  // China mainland needs an ICP filing and a security assessment first.
  excludedTerritories: ['CHN'],
  usesIdfa: false,
  usesNonExemptEncryption: false,
  ageRating: {},
  // What App Review reads: how to test, why the home folder, and what this
  // edition leaves out. Kept beside the launcher it describes.
  reviewNotes: readFileSync(new URL('./app/Desktop/AppReviewNotes.txt', import.meta.url), 'utf8').trim(),
  screenshots: {
    APP_DESKTOP: [
      'resources/app-store/screenshots/1-overview.jpg',
      'resources/app-store/screenshots/2-storage.jpg',
      'resources/app-store/screenshots/3-disk.jpg',
      'resources/app-store/screenshots/4-cleanup.jpg',
      'resources/app-store/screenshots/5-applications.jpg',
    ],
  },
}
