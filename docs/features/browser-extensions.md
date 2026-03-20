---
title: Browser Extensions
---

# Browser Extensions

SystemSweep audits installed extensions across Chrome and Firefox.

## Chrome

Scans `~/Library/Application Support/Google/Chrome/Default/Extensions/`. For each extension:

1. Lists version directories, picks the latest
2. Parses `manifest.json` for name, version, description, permissions
3. Runs `du -sk` to measure disk usage

Extensions are sorted by size (largest first) so you can quickly spot bloated ones.

## Firefox

Scans `~/Library/Application Support/Firefox/Profiles/*/extensions.json` for all profiles matching `*.default-release` or `*.default`.

## Permission Flagging

Extensions are flagged by permission count:
- **>5 permissions** — red badge
- **1–5 permissions** — orange badge
- **0 permissions** — gray "None" badge

This helps identify extensions with broad access to your browsing data.
