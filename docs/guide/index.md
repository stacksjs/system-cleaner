---
title: Introduction
---
## How It Works

1. **Server phase** — `pages/index.stx` executes Node.js code: reads plist files, parses Chrome extension manifests, runs `ps aux`, and recursively scans `~/` for disk usage.
2. **Template phase** — stx processes `@layout('app')`, resolves `@include()` partials, evaluates `@foreach` loops and `@if` conditionals, and interpolates `{{ }}` expressions.
3. **Client phase** — Alpine-style `x-data` scopes handle panel navigation (Cmd+1–5), startup item filtering, bulk selection, and toast notifications. The DiskScope sunburst supports click-to-drill-down with client-side re-layout.
