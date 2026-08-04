#!/usr/bin/env bun
import { createCLI } from '../src/index'

const app = createCLI()
// eslint-disable-next-line ts/no-top-level-await
await app.parse()
