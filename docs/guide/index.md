---
title: Introduction
---

# Introduction

SystemSweep is a single-page stx application that scans your macOS system at render time using Node.js APIs (`fs`, `child_process`, `os`) and presents the results in a native-looking dark UI.

## Architecture

```
pages/index.stx          # Main page — server script + panel routing
layouts/app.stx           # Shared macOS Tahoe chrome + CSS
components/
  DashboardCards.stx      # Health ring, stat cards
  TopProcesses.stx        # Top 8 processes table
  StartupPanel.stx        # Launch Agent/Daemon management
  ExtensionsPanel.stx     # Browser extension audit
  ProcessesPanel.stx      # Full process list
  DiskPanel.stx           # Sunburst disk analyzer (DiskScope)
```

All data is gathered server-side in `<script server>` and rendered via stx directives (`@foreach`, `@if`, `{{ }}`). Client interactivity uses `x-data` reactive scopes for panel switching, filtering, and selection.

## How It Works

1. **Server phase** — `pages/index.stx` executes Node.js code: reads plist files, parses Chrome extension manifests, runs `ps aux`, and recursively scans `~/` for disk usage.
2. **Template phase** — stx processes `@layout('app')`, resolves `@include()` partials, evaluates `@foreach` loops and `@if` conditionals, and interpolates `{{ }}` expressions.
3. **Client phase** — Alpine-style `x-data` scopes handle panel navigation (Cmd+1–5), startup item filtering, bulk selection, and toast notifications. The DiskScope sunburst supports click-to-drill-down with client-side re-layout.
