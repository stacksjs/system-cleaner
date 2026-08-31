---
title: Quick Clean
---

# Quick Clean

The safe first pass: caches, logs and temporary files that macOS and your apps
rebuild on their own.

## What it knows about

Around 260 locations, each one an entry earned by being found on a real machine
rather than by being plausible. They cover:

- **User and system caches**, including the font, QuickLook and icon-services
  caches
- **Logs and crash reports**, yours and the system's
- **Browser caches** for Chrome, Safari, Firefox, Edge, Brave, Arc, Dia, Opera,
  Vivaldi, Chromium and Zen
- **Developer caches** — Xcode `DerivedData`, archives, device support and
  simulator data, Docker images and build cache, and the package caches for
  npm, pnpm, Yarn, Bun, Cargo, Go, Gradle, Maven, CocoaPods and more
- **Application data** — iOS backups and downloaded IPSWs, Mail attachment
  caches, and the second locations that AI tooling and browser automation leave
  behind
- **The Trash**

Targets that need `sudo`, and the handful macOS gates behind a media-library
permission prompt, are left out of the list entirely. Listing them would offer a
Clean button that can only ever fail — and in the gated case, one that hangs
rather than failing.

## Sizes

Nothing is estimated. Each target is measured, and the results are cached for
five minutes so returning to the screen is instant.

The headline total is **overlap-aware**: about thirty of the targets live inside
another one — `~/Library/Caches/Google/Chrome` sits under `~/Library/Caches`,
along with many others — so a path with an ancestor in the same selection
contributes nothing to the total. Adding every row's own figure would report far
more than the disk could ever give back.

## Safe and caution

Every target carries a risk level, and the difference is real:

- **safe** — the app rebuilds or re-downloads it. Nothing is gone for good.
- **caution** — actual content: chat transcripts, downloaded models, virtual
  machine images. Nothing rebuilds these.

Nothing stops you cleaning a caution target, but **Select All leaves them
alone**, and a batch confirmation names them individually rather than
reassuring you that "apps rebuild these files".

## Cleaning

Clean one row, or select several and clean them together. Quick Clean removes a
directory's *contents* and leaves the directory itself, which is what the apps
that own them expect to find.

Emptying the Trash is offered separately, and is the one action on this screen
that cannot be recovered from.

If a directory could not be sized before it was cleaned, the result says
"Cleaned" without a figure rather than claiming it freed nothing — the clean
happened; only the measurement did not.
