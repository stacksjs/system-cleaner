---
title: Disk Analyzer
---

# Disk Analyzer (DiskScope)

An interactive sunburst chart for visualizing disk usage, inspired by DaisyDisk.

## How It Works

1. **Server-side scan** — Recursively walks `~/` up to 6 levels deep, with a 15-second timeout. Skips `node_modules`, `.git`, `.cache`, `DerivedData`, and other known heavy directories (they're still counted via `du`).

2. **Sunburst layout** — Partitions the tree into concentric rings. Each ring represents a depth level. Arc width is proportional to size relative to the parent.

3. **Client-side interactivity** — Click a directory segment to drill down. The chart re-computes layout for that subtree. Click the center circle to go back up.

## Layout

The disk panel has three columns:

- **Left sidebar** — Disk usage bar (Macintosh HD), scan summary, largest items list with color-coded bars
- **Center** — SVG sunburst chart (4 rings, up to 400 segments)
- **Right inspector** — Hover details: name, size, percent of view, depth, path, proportion bar

## Configuration

These constants in the server script control the scan:

| Constant | Default | Description |
|----------|---------|-------------|
| `SCAN_PATH` | `os.homedir()` | Root directory to scan |
| `MAX_DEPTH` | 4 | Visible ring depth |
| `DETAIL_DEPTH` | 6 | Recursion depth for drill-down data |
| `MAX_SCAN_MS` | 15000 | Scan timeout in milliseconds |
| `MAX_SEGMENTS` | 400 | Maximum rendered segments |

## Color Palette

Uses a 20-color DaisyDisk-inspired palette. Each top-level directory gets a base color; deeper levels are progressively lightened.
