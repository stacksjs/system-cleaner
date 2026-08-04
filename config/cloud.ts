import type { CloudConfig as TsCloudConfig } from '@stacksjs/ts-cloud'
import type { CloudConfig } from '@stacksjs/types'

const SHARED_DATABASE = '/var/www/system-cleaner-shared/database/stacks.sqlite'

export const tsCloud: TsCloudConfig = {
  project: {
    name: 'SystemCleaner',
    slug: 'system-cleaner',
    region: 'us-east-1',
  },

  cloud: {
    provider: 'hetzner',
    attachTo: 'stacks',
  },

  mode: 'server',

  environments: {
    production: {
      type: 'production',
      deployBranch: 'main',
      domain: 'system-cleaner.app',
    },
  },

  sites: {
    main: {
      root: '.',
      path: '/',
      domain: 'system-cleaner.app',
      start: 'bun storage/framework/runtime/production/serve.js',
      port: 3080,
      preStart: [
        'bun install --frozen-lockfile',
        'mkdir -p storage/framework/runtime/production',
        'bun build --production --target=bun --packages=external app/ProductionServer.ts --outfile storage/framework/runtime/production/serve.js',
        'mkdir -p /var/www/system-cleaner-shared/database',
        `DB_CONNECTION=sqlite DB_DATABASE_PATH=${SHARED_DATABASE} APP_ENV=production NODE_ENV=production bun node_modules/@stacksjs/buddy/dist/cli.js migrate --force`,
      ],
      env: {
        PORT: '3080',
        APP_ENV: 'production',
        NODE_ENV: 'production',
        APP_URL: 'https://system-cleaner.app',
        API_URL: 'http://127.0.0.1:3081',
        DB_CONNECTION: 'sqlite',
        DB_DATABASE_PATH: SHARED_DATABASE,
      },
    },

    api: {
      root: '.',
      start: 'bun storage/framework/runtime/production/api.js',
      port: 3081,
      preStart: [
        'bun install --frozen-lockfile',
        'mkdir -p storage/framework/runtime/production',
        'bun build --production --target=bun --packages=external node_modules/@stacksjs/actions/dist/serve/api.js --outfile storage/framework/runtime/production/api.js',
        'mkdir -p /var/www/system-cleaner-shared/database',
      ],
      env: {
        PORT: '3081',
        HOST: '127.0.0.1',
        APP_ENV: 'production',
        NODE_ENV: 'production',
        APP_URL: 'https://system-cleaner.app',
        DB_CONNECTION: 'sqlite',
        DB_DATABASE_PATH: SHARED_DATABASE,
      },
    },

    www: {
      domain: 'www.system-cleaner.app',
      redirect: { to: 'https://system-cleaner.app', status: 301 },
    },
  },

  infrastructure: {
    dns: {
      provider: 'porkbun',
      domain: 'system-cleaner.app',
    },
  },
}

const config: CloudConfig = {}

export default config
