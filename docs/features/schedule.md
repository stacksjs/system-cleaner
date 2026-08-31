---
title: Schedule
---

# Schedule

Cleans automatically, whether or not the app is open.

## Why launchd and not a timer

The app is not running at 3am. A `setInterval` inside the window only fires
while the window is open, which is exactly when the Clean button is already in
front of you.

So the schedule is a launch agent at
`~/Library/LaunchAgents/app.systemcleaner.schedule.plist`, and it invokes the
same agent binary the app already ships with a `--run-schedule` flag. There is
no second binary to build and sign, and the unattended run executes the same
code the window does.

If your Mac is asleep at the appointed time, launchd runs the job when it next
wakes rather than skipping the week.

## What can be scheduled

Only clean targets marked **safe**. The ones Quick Clean flags as *caution* —
chat transcripts, downloaded models, virtual machine images — hold content
nothing rebuilds, so they stay a deliberate choice you make while looking at
them.

Two extras sit above the target list:

- **Clear browser caches and history.** Cookies, sessions, and logins are never
  touched by a scheduled run — only the parts browsers rebuild on their own. A
  clean that signed you out of everything while you slept would be uninstalled
  the same morning.
- **Empty the Trash.** Off by default. It is the one step in an unattended run
  that cannot be undone.

Saving with nothing selected removes the launch agent rather than scheduling an
empty run.

## Seeing what happened

The screen reports launchd's state, not just the saved settings, so a plist
deleted by hand cannot leave the app claiming a clean is scheduled.

Each run appends to `~/Library/Logs/SystemCleaner/schedule.log`, shown at the
bottom of the screen, and is recorded in the same cleanup history that feeds
**Reclaimed all time**.

**Run Now** does exactly what the schedule would do, immediately.
