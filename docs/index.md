---
title: SystemSweep
layout: home
---

# SystemSweep

A macOS-native system performance manager for monitoring and cleaning startup apps, browser extensions, hidden background processes, and disk usage.

Built with [stx](https://github.com/stacksjs/stx) and powered by Bun.

## Quick Start

```bash
bun install
bun run dev      # http://localhost:3456
bun run native   # Craft desktop window
```

## Features

- **Dashboard** — Health score, memory/CPU/disk gauges, top processes
- **Startup Items** — Scan and manage Launch Agents & Daemons
- **Browser Extensions** — Audit Chrome and Firefox extensions by size and permissions
- **Background Processes** — Monitor CPU/memory hogs, kill runaway processes
- **Disk Analyzer** — Interactive sunburst chart (DiskScope) for visualizing disk usage
