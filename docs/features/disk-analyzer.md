---
title: Disk Analyzer
---
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
