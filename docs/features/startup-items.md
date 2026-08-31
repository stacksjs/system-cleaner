---
title: Startup Items
---

# Startup Items

Everything that launches when your Mac starts, in one list, with what it belongs
to and what to do about it.

## What is listed

Launch agents and daemons from the three locations macOS actually reads:

| Location | Scope | Runs |
|---|---|---|
| `~/Library/LaunchAgents` | User | When you log in |
| `/Library/LaunchAgents` | System | When any user logs in |
| `/Library/LaunchDaemons` | System | At boot, before login |

Each entry's plist is parsed for its label, the program it runs, and three flags
worth seeing: **RunAtLoad** (it starts immediately rather than waiting to be
triggered), **KeepAlive** (macOS restarts it if it exits), and whether it is
currently disabled.

## Reading the list

Items are grouped by who they belong to — Apple, Microsoft, Google, Adobe,
Docker, Homebrew, 1Password, Steam and a couple of dozen others are recognised
by label — and everything else is shown as **Third-party**.

The tabs narrow the list to **Enabled**, **Third-party** or **Apple**. Disabled
items sort to the bottom.

## Disabling and removing

**Disable** runs `launchctl unload -w`, which stops it now and keeps it from
starting again. It is reversible: **Enable** puts it back with `launchctl load
-w`.

**Delete** unloads the agent and removes its plist. That is not reversible from
here — reinstalling the software that put it there is usually what brings it
back.

Apple's own items show no buttons at all. They are part of macOS, and disabling
one breaks a system service rather than speeding anything up.

## Where a password is asked for

A user agent under `~/Library/LaunchAgents` is yours, and changes to it need
nothing. Anything under `/Library` belongs to every account on the Mac, so those
changes are run through `osascript ... with administrator privileges` and macOS
asks for your password. Cancelling the prompt cancels the change.

## Safety

Only the three directories above are accepted, and the path is resolved and
re-checked before anything runs — a path that tries to traverse out of them with
`..` is rejected, and the filename is escaped twice on the system path, once for
the shell and once for AppleScript.
