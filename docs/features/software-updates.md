---
title: Software Updates
---

# Software Updates

Everything on the Mac that has a newer version, in one queue.

## What is checked

| Source | |
|---|---|
| **macOS** | System updates from `softwareupdate`, plus whether a newer major release is available and whether the Command Line Tools are current |
| **Homebrew** | Outdated formulae and casks, with pinned formulae marked as pinned rather than as out of date |
| **Pantry** | Tracked packages and their wanted and latest versions |
| **Desktop apps** | Everything in `/Applications`, matched to a Homebrew cask where one exists, with its installed version compared to the cask's |

Apps that update themselves are marked as such, so a version that looks stale
but is managed by its own updater does not read as neglect.

## Why it never blocks the window

Asking `brew` what is outdated takes seconds, and asking `softwareupdate` can
take considerably longer. So the check runs outside page rendering entirely, in
two tiers:

- **quick** — the cheap sources, cached for five minutes
- **full** — everything, cached for fifteen

Identical concurrent requests are collapsed into one, so opening the screen
twice does not run two scans. Opening SystemCleaner never waits on a package
manager, and the sidebar count comes from a summary that is cheaper still.

## Updating

Homebrew formulae and casks can be updated individually or all at once, from
this screen.

macOS updates and Mac App Store updates are not applied here — the buttons open
**System Settings → Software Update** and the App Store's Updates page
respectively. Applying a system update means restarts, firmware and FileVault
prompts, and Apple's own interface is the right place for that.

## Version comparison

Versions are compared semantically rather than as strings, so `1.10.0` is
correctly newer than `1.9.0`, and terminal colour codes from tools that emit
them are stripped before anything reaches the interface.
