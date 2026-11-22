import type { DesktopConfig } from '@stacksjs/types'

export default {
  launcher: {
    appName: 'SystemCleaner',
    bundleId: 'org.stacksjs.system-cleaner',
    views: {
      routes: ['/app'],
      clientScripts: 'resources/scripts',
      env: { SYSTEM_CLEANER_AGENT: '1' },
    },
    sqliteMigrations: true,
    resources: { 'ICU-LICENSE.txt': 'resources/licenses/ICU.txt' },
    dmg: {
      background: 'resources/dmg/installer-background.png',
      width: 660,
      height: 460,
      iconSize: 128,
      appPosition: [165, 200],
      applicationsPosition: [495, 200],
      format: 'ULMO',
    },
    githubUpdates: 'stacksjs/system-cleaner',
    appStore: {
      teamId: '3JJRNQW6B7',
      version: '1.0.0',
      minimumSystemVersion: '15.0',
      category: 'public.app-category.utilities',
      icon: 'resources/assets/images/AppIcon.icns',
      networkServer: true,
      userSelectedFiles: true,
    },
  },
} satisfies DesktopConfig
