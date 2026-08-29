---
title: Disk Analyzer
---

# Disk Analyzer

An interactive sunburst of where the disk went. Click **Scan Disk**, then click
any segment to drill into it and the centre to come back out. Hovering a segment
shows its size, its share of the current view, its depth, and its full path,
with **Reveal in Finder** and a delete action for directories.

## While it runs

A scan reports what it is doing: the number of items walked, the elapsed time,
and the directory it is in, updating four times a second. A first scan of a
large home folder takes up to a minute.

If the count sits at zero for eight seconds, the scan is not slow — it is
stopped, waiting on a macOS permission it has not been granted. The screen says
so and names Full Disk Access rather than counting up to a timeout.

## What it skips, and why

- **Cloud providers** — iCloud Drive, Dropbox, OneDrive, Google Drive — are
  sized with `du` rather than walked. A file that lives in the cloud is not
  occupying the local disk, `du` counts allocated blocks so a placeholder
  correctly counts as nothing, and stat-ing a dataless placeholder asks macOS to
  download it.
- **Dependency directories** — `node_modules`, `.git`, `DerivedData` and friends
  — are sized whole instead of recursed. You clear one of those entirely, not a
  file at a time.

A scan that runs out of time says the chart is partial. Everything shown is
real; there is simply more beneath it.

## On making it faster

The walker is not the bottleneck, and this was measured rather than assumed.
On a home directory whose permissions had not been granted, the scan spent 87
minutes against a 180-second budget having visited 49 directories. `du -x -d 6`
over the same tree — the identical job in C — took 94 minutes at **1% CPU**:
103 seconds of CPU spread across 143,140 directories. Both were parked in the
kernel waiting, not computing.

So a faster walker, a thread pool, or shelling out to `du` buys nothing against
what actually stops a scan. Granting the permission does. Progress reporting,
folding the trees that cannot answer promptly, and killing a scan that has
stopped responding are the parts that help, and are what the app does.
