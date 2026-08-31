---
title: Applications
---

# Applications

Everything installed on the Mac: what it is, what it takes up, and what it
leaves behind when it goes.

This screen used to be two. **System** listed applications by size and showed
the volume they sat on but could not remove any of them; the **Uninstaller**
removed them but never said how much room that would leave you. They asked and
answered halves of the same question, so they are one screen now.

## The app list

Applications from `/Applications`, `/Applications/Utilities` and
`~/Applications`, each with its real icon read from its own bundle and its size
measured with `du`.

The list renders as soon as the names are known and fills the sizes in
afterwards: sizing a hundred-odd bundles takes seconds, and the list is useful
before the numbers arrive. Results are cached for fifteen minutes.

Selecting an app replaces the volume readout with its details — version, bundle
identifier, install date, size and path.

## The volume readout

Capacity, used, and available for the boot volume, read from `df` and
`diskutil`, with **purgeable** space called out separately.

Purgeable is worth understanding, because it is the usual explanation for "the
Finder says I have 40 GB free and this app says otherwise": macOS counts space
held by local Time Machine snapshots and cached iCloud files as available,
because it will reclaim that space when something actually needs it. It is real,
but it is not free in the way an empty disk is free.

The usage bar is coloured by how full the disk is rather than by a fixed
gradient — amber past 75%, red past 90%. A bar that ended in green at 99% would
be saying "fine" on the one screen whose job is to say otherwise.

## Why the Trash is not enough

Dragging an app to the Trash removes the bundle. Everything the app wrote
outside it stays: preferences, caches, containers, saved window state, launch
agents, install receipts, and whatever it dropped in `~/.config` or as a dotfile
in your home folder. On a Mac that has been in use for a few years those
leftovers are frequently the larger half.

## Reviewing an app

Press **Review** on any row. The scan searches around fifty known locations
under `~/Library`, `/Library`, and your home folder, matching by bundle
identifier and by the naming variants an app might use — `Maestro Studio` is
also looked for as `MaestroStudio`, `maestro-studio`, `maestro_studio`, and
`Maestro`.

Every result is listed with its kind, its path, and its size, and every result
can be unticked. That is deliberate: no heuristic can tell a licence file from a
cache, because Application Support holds both, and re-entering a licence key is
a worse afternoon than leaving four kilobytes on the disk.

Two kinds of row cannot be selected:

- **protected** — a path you marked *Protect* on the Large Files screen
- **needs admin** — anything outside your home folder, which is every
  system-wide launch daemon and install receipt. Removing those needs
  administrator rights the app does not have, so they are shown, with their
  location, rather than offered behind a button that can only fail.

**Move to Trash** is the default and is recoverable from Finder. **Delete
Permanently** is not.

## Left behind by apps you have already removed

The second table finds caches, logs, saved state, WebKit data, and HTTP storage
whose owning bundle identifier no longer resolves to anything installed. Nothing
else in the app can find these: Quick Clean works from a fixed list of paths,
and these are by definition the leftovers of software that list never knew
about.

Password managers, keychains, SSH and GPG data, and anything Apple's own are
never treated as orphaned, whatever their bundle identifier looks like.

## Apple's own apps

They are not listed. They are part of macOS, and removing one breaks software
updates rather than freeing space.
