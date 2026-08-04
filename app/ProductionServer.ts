import process from 'node:process'
import { cli } from '@stacksjs/cli'
import { serve } from '../node_modules/@stacksjs/buddy/dist/commands/serve.js'

process.env.APP_ENV ||= 'production'
process.env.NODE_ENV ||= 'production'

const buddy = cli('buddy')
serve(buddy)
process.argv.splice(2, 0, 'serve')
await buddy.parse()
