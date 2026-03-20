---
title: Startup Items
---

# Startup Items

SystemSweep scans three directories for Launch Agents and Daemons:

| Directory | Scope | Type |
|-----------|-------|------|
| `~/Library/LaunchAgents` | User | Agent |
| `/Library/LaunchAgents` | System | Agent |
| `/Library/LaunchDaemons` | System | Daemon |

## What Gets Scanned

Each `.plist` file is parsed to extract:

- **Label** — the service identifier (e.g. `com.google.keystone.agent`)
- **RunAtLoad** — whether it starts automatically on login
- **KeepAlive** — whether launchd restarts it if it exits
- **Disabled** — whether the user has disabled it
- **Program** — the executable path

## Vendor Detection

Items are categorized by matching the label against known vendor prefixes: Apple, Google, Microsoft, Adobe, Spotify, Dropbox, Docker, Homebrew, Slack, Zoom, 1Password, Raycast, Steam, and more. Unknown items are labeled "Third-party".

## Filtering

The tab bar filters items reactively:
- **All** — shows everything
- **Enabled** — hides disabled items
- **Third-party** — hides Apple system agents
- **Apple** — shows only `com.apple.*` items
