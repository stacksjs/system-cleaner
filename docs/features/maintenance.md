---
title: Maintenance
---

# Maintenance

The macOS routines that fix the things the system quietly gets stuck on.

Each task is named for what it repairs rather than what it does. "Rebuild Launch
Services" means nothing to most people; "fixes an Open With menu full of apps
you deleted" is the reason someone came looking.

## Tasks the app runs

Rebuild Launch Services, restart Finder, restart the Dock, clear the font cache,
reset QuickLook, clear saved window state older than 30 days, compact the Mail
and Safari databases, check preference files for corruption, and repair home
directory permissions.

Half of these succeed silently — `killall Dock` prints nothing — so the output
of each run is kept and shown under the row. Without it there is no difference
on screen between "done" and "did nothing at all".

## Tasks the app will not run

Anything needing `sudo` is marked **needs Terminal** and offers its command to
the clipboard instead. This is not caution for its own sake: the agent has no
terminal, so a password prompt would be written to a pipe nobody is reading and
the task would hang until it timed out. An honest "here is what to run" is the
better version of the same help.

That covers flushing DNS, resetting the network stack, resetting Bluetooth,
rebuilding the Spotlight index, running the periodic scripts, purging inactive
memory, and rebuilding the boot caches.

## Housekeeping

Two sweeps that do not warrant a screen each:

- **`.DS_Store` files** — Finder's per-folder view settings, scattered through
  your home folder and into every archive you share. Finder recreates them as
  you open folders; the icon positions and view settings in those folders are
  lost.
- **Unfinished downloads** — half-downloaded `.download`, `.crdownload`, and
  `.part` files. Anything still downloading is detected with `lsof` and skipped.

## Secure Erase

Overwrites a file's contents with random data, flushes that to the device,
truncates it, renames it so the old name does not survive in the directory, and
unlinks it. There is no Trash step.

What it cannot promise: on APFS — every Mac since 2017 — a write does not
necessarily land on the blocks it replaces. The filesystem is copy-on-write and
the SSD's controller remaps underneath that, so the original blocks may still
exist in flash with no file pointing at them. Apple removed Secure Empty Trash
in 10.11 for exactly this reason.

It is still worth having: it defeats every undelete tool that works through the
filesystem, which is what people mean by shredding. For the stronger guarantee,
turn on FileVault — then the leftover blocks are unreadable whether or not they
were overwritten.

Files over 8 GB are refused rather than ground through, because a UI that
appears hung is a worse outcome than an honest refusal.
