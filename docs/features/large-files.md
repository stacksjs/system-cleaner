---
title: Large Files
---

# Large Files

Finds the biggest items on the Mac and clears as many of them as you like in one
pass.

## Scanning

Pick a folder under **Search in** and a floor under **Minimum size**. The scan
walks the tree and keeps a running top-N by size, so it costs the same on a 4 TB
home directory as on a 40 GB one.

Three things are skipped, each for a reason:

- **Dependency and build directories** — `node_modules`, `.git`, `DerivedData`,
  `target`, `Pods`, and friends. They hold most of the files on a developer's
  Mac and almost never an individually deletable large one. You clear a bloated
  `node_modules` whole, from the Disk Usage view, not a file at a time.
- **Cloud providers** — iCloud Drive, Dropbox, OneDrive, Google Drive. A file
  that lives in the cloud is not occupying the local disk you are reclaiming,
  and touching a dataless placeholder asks macOS to download it.
- **The Trash** — it has its own screen and its own Empty action.

Document bundles (`.app`, `.photoslibrary`, `.sparsebundle`, `.fcpbundle`, ...)
are reported as one item sized from everything inside them, because that is how
macOS presents them and how you would delete them.

A scan that runs out of time says so and shows the largest items found so far.
Narrowing **Search in** to a single folder covers it completely and finishes
much faster.

## Selecting and deleting

Tick rows, or **Select All** to take everything currently listed — the filter
and category chips narrow what "everything" means. The bar at the top of the
list shows how many items are selected and how much they add up to.

**Move to Trash** is the default and is recoverable from Finder. It asks Finder
once per batch of 100 rather than once per file, so clearing a few hundred items
is a few round trips instead of a few hundred. **Delete Permanently** is an
`rm -rf` and is not.

Three outcomes are reported separately, because they mean different things:

- **skipped** — refused before touching the disk: the path is protected, or it
  sits somewhere the app will not delete from (outside your home folder, or
  inside a sensitive directory such as `.ssh` or `.gnupg`)
- **failed** — attempted, and the filesystem said no
- **removed** — gone, with the bytes reclaimed

## Protecting a file

Most Macs surface the same handful of legitimately huge files at the top of
every scan — a VM image, a video project, a Time Machine sparsebundle. Mark one
**Protect** and it is excluded from selection permanently, and refused even if a
request names it directly.

## History

Every cleanup is recorded, so **Reclaimed all time** survives restarts. The
history lives in `~/Library/Application Support/SystemCleaner/`, on your Mac and
nowhere else.
