#!/usr/bin/env bun
import process from 'node:process'
import { createCLI, refuseUnsupported } from '../src/index'

// Before dispatch, not inside each command. A platform with no implementation
// makes every command find nothing - exec cannot run `launchctl` or `df -k`,
// the failure is swallowed, and `clean` reports 0 B reclaimable. In a binary
// there is no UI to explain that "nothing" meant "I cannot see", so the
// refusal has to come first and say which platform and which feature.
if (refuseUnsupported(process.argv.slice(2)))
  process.exit(1)

const app = createCLI()
// eslint-disable-next-line ts/no-top-level-await
await app.parse()
