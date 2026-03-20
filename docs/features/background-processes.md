---
title: Background Processes
---

# Background Processes

SystemSweep reads a snapshot of `ps aux` and filters for processes above a resource threshold.

## Threshold

A process is shown if:
- CPU usage >= 0.1%, or
- Memory usage >= 0.3%

Low-resource system processes (`/usr/libexec/*`, `/System/*`, root with near-zero usage) are hidden to reduce noise.

## Displayed Info

| Column | Source |
|--------|--------|
| Process | `basename` of the command |
| PID | Process ID |
| CPU | `%CPU` column with color-coded bar |
| Memory | Computed as `%MEM * total_mem` in MB |
| User | Process owner; system users flagged orange |

## Color Coding

- **>50% CPU** — red
- **>20% CPU** — orange
- **<= 20% CPU** — green

## System Protection

Processes owned by `root` or system users (prefixed with `_`) are marked "Protected" and cannot be killed from the UI.
