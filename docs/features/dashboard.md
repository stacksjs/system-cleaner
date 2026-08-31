---
title: Dashboard
---

# Dashboard

One screen that answers "is anything wrong, and where should I look".

## The health score

A single number out of 100, built from live measurements rather than from how
many "issues" a scan managed to find. It starts at 100 and subtracts for each
signal that is genuinely under strain:

| Signal | Weight | What it looks at |
|---|---|---|
| CPU | 30 | Usage, and load average relative to core count |
| Memory | 25 | Usage, macOS memory pressure, and swap in use |
| Disk | 20 | How full each volume is |
| Thermal | 15 | CPU temperature |
| Disk I/O | 10 | Sustained read and write throughput |

Battery health and an unusually long startup-item list contribute smaller
penalties.

Every deduction is listed with its cause and its size, so the score is
explainable rather than decorative — "CPU at 84%" and "3.1 GB swap used" tell
you what to do next; "your Mac scored 62" does not.

A score that does not move is the honest outcome on a healthy Mac. Nothing here
manufactures problems to justify a button.

## The cards

CPU with its core count, memory with what is actually available, disk with
capacity and purgeable space, pending updates, and the number of startup items.

## Activity

A rolling chart of CPU and memory over the session, so a spike you just noticed
has some context behind it, and the processes using the most right now — the
same data as the [Processes](./background-processes.md) screen, in short form.

## Where the numbers come from

Everything on this screen is read from the machine the app is running on, when
the screen asks for it. Nothing is precomputed at build time: the packaged app
ships prerendered HTML, so host facts arrive over the local API and are bound
in the page. That is why the cards fill in a moment after the window opens
rather than being present in the markup.
