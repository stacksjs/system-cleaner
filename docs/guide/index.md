---
title: Introduction
---

# SystemCleaner

A macOS system cleaner and performance manager that runs entirely on your Mac.

## What it is for

Disks fill up in ways the Finder does not explain. Caches that no app will ever
read again, an Xcode `DerivedData` measured in tens of gigabytes, three copies
of the same video, iOS backups from a phone you no longer own, and the
preferences and containers of applications you deleted years ago.

SystemCleaner finds those, shows them to you with their sizes, and removes the
ones you pick. It also covers the neighbouring jobs that would otherwise need
three more apps: uninstalling software properly, clearing browser data without
signing yourself out of everything, and running the macOS maintenance routines
that fix stuck menus and wrong fonts.

## What it will not do

- **Guess.** Sizes are measured, not estimated. Duplicates are confirmed with a
  full content hash before they are called duplicates.
- **Delete quietly.** Every destructive action is listed first, and the default
  is always the Trash where the Trash is possible.
- **Phone home.** There is no account and no telemetry. See
  [Privacy](#privacy) below.
- **Promise what the hardware will not give.** Secure erase says plainly what it
  can and cannot guarantee on an SSD.

## Requirements

macOS 14 Sonoma or later, on Apple silicon.

## Privacy

The interface is a local web view talking to an agent bound to `127.0.0.1`. The
agent is started by the app and stopped with it, and the routes it serves are
registered only when it is running as that local agent — on the public website,
which renders the same interface, they do not exist at all.

Your cleanup history, protected paths and cookie keep-list live in a SQLite
database under `~/Library/Application Support/SystemCleaner/`. The only outbound
requests the app ever makes are the update checks you ask for, which go to
Apple, Homebrew and Pantry directly.

## Where to go next

- [Installation](./installation.md) — download, or build from source
- [Usage](./usage.md) — a tour of every screen
- [Features](/features/) — one page per screen, in depth
- [Desktop App](./desktop-app.md) — how the bundle is built
