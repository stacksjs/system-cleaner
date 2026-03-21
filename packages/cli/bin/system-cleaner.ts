#!/usr/bin/env bun
import { createCLI } from '../src/index'

const app = createCLI()
await app.parse()
