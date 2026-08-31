import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A site whose cookies a privacy clean must leave alone.
 *
 * This list is the reason the cookie checkbox is usable at all. Clearing every
 * cookie signs you out of everything you own, so the box goes permanently
 * unticked and the feature may as well not exist. With a keep-list, clearing
 * cookies costs nothing you care about, which is the difference between a
 * feature people have and a feature people use.
 *
 * Matching is by suffix, so `github.com` also keeps `gist.github.com` — see
 * `clearSqliteRows` in `packages/clean/src/privacy.ts`.
 *
 * No `useApi`, for the same reason as [CleanupRun]: see that model's note.
 */
export default defineModel({
  name: 'KeptCookie',
  table: 'kept_cookies',
  primaryKey: 'id',
  autoIncrement: true,

  traits: {
    useTimestamps: true,
  },

  attributes: {
    domain: {
      order: 1,
      fillable: true,
      unique: true,
      validation: {
        rule: schema.string().required().max(255),
      },
      factory: faker => faker.internet.domainName(),
    },
  },
} as const)
