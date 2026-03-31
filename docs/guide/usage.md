---
title: Usage
---
- Memory pressure (penalized above 70%)
- Disk usage (penalized above 80%)
- Number of startup items (penalized per 5 active)
- CPU-intensive processes (penalized for >10% CPU)

Below the score, stat cards show CPU, memory, disk, startup item count, and extension count. A quick-view table lists the top 8 processes by CPU usage.

## Actions

Actions like "Disable", "Remove", and "Kill" run in **demo mode** — they show a toast notification explaining what would happen but don't modify the system. To enable real actions, the server script would need to call `launchctl` or `kill` — see the source for extension points.

## Filtering

The Startup Items panel supports tab-based filtering:

- **All** — every agent and daemon
- **Enabled** — only active items
- **Third-party** — non-Apple vendor items
- **Apple** — system agents

Filtering is reactive via `x-data` — no page reload needed.
