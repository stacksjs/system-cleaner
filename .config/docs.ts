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
        ],
      },
    ],
    '/features/': [
      {
        text: 'Features',
        items: [
          { text: 'Overview', link: '/features/' },
          { text: 'Startup Items', link: '/features/startup-items' },
          { text: 'Browser Extensions', link: '/features/browser-extensions' },
          {
            text: 'Background Processes',
            link: '/features/background-processes',
          },
          { text: 'Disk Analyzer', link: '/features/disk-analyzer' },
        ],
      },
    ],
  },
};
