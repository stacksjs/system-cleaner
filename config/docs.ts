export default {
  docsDir: './docs',
  outDir: './dist/docs',
  theme: 'vitepress',

  markdown: {
    title: 'SystemCleaner',
    meta: {
      description: 'A macOS-native system performance manager',
    },
  },

  nav: [
    { text: 'Guide', link: '/guide/' },
    { text: 'Features', link: '/features/' },
  ],

  sidebar: {
    '/guide/': [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/guide/' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Usage', link: '/guide/usage' },
          { text: 'Desktop App', link: '/guide/desktop-app' },
          { text: 'Mac App Store', link: '/guide/mac-app-store' },
        ],
      },
    ],
    '/features/': [
      {
        text: 'Features',
        items: [
          { text: 'Overview', link: '/features/' },
          { text: 'Dashboard', link: '/features/dashboard' },
          { text: 'Quick Clean', link: '/features/quick-clean' },
          { text: 'Disk Analyzer', link: '/features/disk-analyzer' },
          { text: 'Large Files', link: '/features/large-files' },
          { text: 'Duplicates', link: '/features/duplicates' },
          { text: 'Applications', link: '/features/applications' },
          { text: 'Privacy', link: '/features/privacy' },
          { text: 'Maintenance', link: '/features/maintenance' },
          { text: 'Schedule', link: '/features/schedule' },
          { text: 'Startup Items', link: '/features/startup-items' },
          { text: 'Browser Extensions', link: '/features/browser-extensions' },
          {
            text: 'Background Processes',
            link: '/features/background-processes',
          },
          { text: 'Software Updates', link: '/features/software-updates' },
        ],
      },
    ],
  },
};
