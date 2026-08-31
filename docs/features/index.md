---
title: Features Overview
---

# Features

One page per screen. Every one of them runs locally, lists what it found before
it changes anything, and reports removed, skipped and failed separately.

## Reclaiming space

| | |
|---|---|
| [Quick Clean](./quick-clean.md) | 260+ known cache, log and temporary-file locations, sized and reviewable |
| [Disk Analyzer](./disk-analyzer.md) | An interactive map of where the space actually went |
| [Large Files](./large-files.md) | The biggest individual items, with bulk selection and a protect list |
| [Duplicates](./duplicates.md) | Byte-for-byte identical files, verified by a full content hash |
| [Applications](./applications.md) | Everything installed, what it takes up, and what it leaves behind when it goes |

## Keeping it clean

| | |
|---|---|
| [Privacy](./privacy.md) | Browser and system traces, with a cookie keep-list |
| [Maintenance](./maintenance.md) | macOS repair routines, housekeeping sweeps, and secure erase |
| [Schedule](./schedule.md) | Automatic cleaning that runs with the app closed |

## Understanding the machine

| | |
|---|---|
| [Dashboard](./dashboard.md) | The health score, live metrics, and what needs attention |
| [Startup Items](./startup-items.md) | Launch agents and daemons that run at login |
| [Browser Extensions](./browser-extensions.md) | Add-ons across every browser profile, with sizes and removal |
| [Background Processes](./background-processes.md) | Live CPU and memory, with guarded termination |
| [Software Updates](./software-updates.md) | macOS, Homebrew, Pantry and desktop apps in one queue |

## What they have in common

**Nothing is deleted without being listed first.** Every screen shows the path
and the measured size of each item before offering to remove it.

**Move to Trash is the default** wherever the Trash is possible, and stays
recoverable from Finder. Permanent deletion has to be asked for by name.

**The same safety gate applies to all of them.** Paths outside your home folder
and `/Applications` are refused; sensitive directories such as `.ssh`, `.gnupg`,
`.aws` and Keychains are refused even when named directly; symlinks are never
followed; and anything on your protected list is refused.

**Long scans survive navigation.** They run in the agent rather than the page,
so leaving a screen does not cancel the work, and the rail marks the section
that is still busy.
