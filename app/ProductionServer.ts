import process from 'node:process'
import { cli } from '@stacksjs/cli'
// buddy does not re-export `serve` from its package entry, so the production
// entrypoint has to reach the built command directly.
// eslint-disable-next-line pickier/no-import-dist, pickier/no-import-node-modules-by-path
import { serve } from '../node_modules/@stacksjs/buddy/dist/commands/serve.js'

process.env.APP_ENV ||= 'production'
process.env.NODE_ENV ||= 'production'

const buddy = cli('buddy')
serve(buddy)
process.argv.splice(2, 0, 'serve')
// This file is the process entrypoint; parsing is the last thing it does.
// eslint-disable-next-line ts/no-top-level-await
await buddy.parse()
