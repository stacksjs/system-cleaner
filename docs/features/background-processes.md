---
title: Background Processes
---

# Background Processes

What is using the CPU and memory right now, and the ability to stop it.

## The list

The twenty heaviest processes, read from `ps` and refreshed while the screen is
open. Each row carries the process name, its full command, its owner, its CPU
percentage and its resident memory in megabytes.

Processes belonging to the system are marked, because they are the ones you
should be slowest to touch: a `kernel_task` at high CPU is macOS managing
thermals, and killing a system daemon usually means macOS restarts it a second
later, having lost whatever it was doing.

The cards above the table total the CPU and memory across the listed processes
and name the single largest consumer of each, which is normally the question
being asked.

## Stopping a process

**Kill** sends `SIGTERM` — the polite signal that asks a process to shut down
and lets it save first. It is not `SIGKILL`.

Two conditions are checked before the signal is sent, and both are enforced in
the engine rather than the interface:

- The PID has to be a real, currently running process.
- It has to be **owned by you**. A request to kill a process belonging to root
  or another user is refused outright, with a 403 rather than a quiet failure.

That is a deliberate ceiling. Killing another user's process needs
administrator rights, and a cleaner is not the right place to be granted them.

## When to use it

An app that has stopped responding and is spinning a core, a background updater
that has been at 100% for an hour, a language server that has leaked its way to
several gigabytes. For anything longer-lived than that — something that comes
back every time you log in — the answer is [Startup
Items](./startup-items.md), not this screen.
