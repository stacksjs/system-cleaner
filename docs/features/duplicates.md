---
title: Duplicates
---

# Duplicates

Finds files that are identical byte for byte and keeps one of each.

## How a file is called a duplicate

Three passes, cheapest first, because the expensive one must never run on more
than it has to:

1. **Size.** Two files of different lengths cannot be duplicates. This is one
   `lstat` per file and discards almost everything.
2. **Signature.** The first and last 64 KB of each same-size candidate. Files
   that differ usually differ in their first block — a header, a magic number,
   an EXIF timestamp — so this kills most of what pass one let through, for the
   cost of two reads.
3. **Full hash.** A SHA-256 of the whole file, for whatever survived both. This
   is the pass that makes the answer trustworthy, and the only one where a wrong
   result would lose data.

A group is reported only once every file in it has been hashed in full. If the
scan runs out of time, or a group is too large to fit the hashing budget, the
group is dropped and the scan reports itself as partial — an unverified
"duplicate" is worse than a missing one, because you act on it.

## Which copy is kept

The oldest one, by modification time: it is the copy the others were made from,
so it is the one other things are most likely to point at. On a tie the
shallowest path wins, which prefers `~/Documents/tax.pdf` over
`~/Downloads/tax (3).pdf`.

The suggestion is marked **suggested keeper** and left unticked. Ticking a
different row instead is the way to keep a different copy — nothing forces the
suggestion.

**Select All Extra Copies** ticks everything except each group's keeper, so
every group keeps one copy no matter what.

## What is skipped

- **Application bundles** and other document bundles. Two copies of the same app
  contain thousands of identical framework files, which would bury every real
  finding.
- **Dependency and build directories** — `node_modules`, `.git`, `DerivedData`,
  and friends. They are full of files that are legitimately identical across
  projects, and deleting one breaks the thing that depends on it.
- **Files under the minimum size**, 1 MB by default. Below that the honest
  answer is thousands of identical icons and lock files.
