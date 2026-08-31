---
title: Usage
---

# Usage

The window is an icon rail on the left and one screen at a time on the right.
Every screen is in the **View** menu; the first nine are on ⌘1 through ⌘9 in
rail order, and ⌘R re-runs whatever the current screen calls a scan.

## Start here

**Dashboard** is the overview: a health score built from live CPU, memory,
thermal, disk and I/O signals, the processes using the most right now, and how
full the disk is.

**Quick Clean** is the safe first pass. It sizes 260-odd known cache and log
locations and lets you clear the ones you pick. Targets marked *caution* hold
content nothing rebuilds — chat transcripts, downloaded models, virtual machine
images — and Select All deliberately leaves them alone.

## Reclaiming real space

When Quick Clean is not enough, the space is usually in one of four places, and
each has a screen:

- **Disk Usage** — an interactive sunburst of where it actually went. Start here
  when you do not yet know.
- **Large Files** — the biggest individual items, with bulk selection.
- **Duplicates** — files that are identical byte for byte, keeping one of each.
- **Applications** — everything installed, what it takes up, and everything it
  leaves behind when it goes.

## Keeping it clean

- **Schedule** runs a clean automatically, whether or not the app is open.
- **Maintenance** fixes the things macOS gets stuck on, and holds the secure
  erase tool.
- **Privacy** clears browser and system traces, with a keep-list so you stay
  signed in where you want to.

## Understanding your Mac

- **Startup Items** — what runs at login, and what to do about it.
- **Extensions** — browser add-ons across every profile, with permission counts and removal.
- **Processes** — live CPU and memory, with guarded termination.
- **Updates** — macOS, Homebrew, Pantry and desktop apps in one queue.
- **System** — every installed app by size, and the volume readout.

## Reading a result

Anything that deletes reports three outcomes separately, because they mean
different things:

- **removed** — gone, with the bytes reclaimed
- **skipped** — refused before the disk was touched: the path is protected, or
  it sits somewhere the app will not delete from
- **failed** — attempted, and the filesystem said no

**Move to Trash** is the default wherever it is possible and stays recoverable
from Finder. **Delete Permanently** is an `rm -rf` and is not. Secure erase, on
the Maintenance screen, is neither — it overwrites first.

## Protecting something

Most Macs surface the same handful of legitimately huge files at the top of
every scan. Press **Protect** on one and it is excluded from selection
permanently, and refused even if a later request names it directly.

## When a scan is slow

A full-home walk runs for tens of seconds and reports its progress while it
does. Leaving the screen does not cancel it — the scan continues in the agent
and the rail marks the section with a dot, so coming back picks up the result
rather than starting over.

If a scan says it stopped early, narrowing **Search in** to a single folder
covers that folder completely and finishes much faster.

If the count stops moving for several seconds, macOS is holding a read until
someone answers a permission prompt. Answer it, or grant SystemCleaner Full Disk
Access in System Settings → Privacy & Security.
