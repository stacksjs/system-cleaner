# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SystemCleaner is a macOS desktop app for system optimization, built with Bun, TypeScript, and the STX framework. It provides a web UI for monitoring system health, managing startup items, cleaning caches/logs, analyzing disk usage, and managing package updates (Homebrew/Pantry).

## Commands

```bash
bun run dev          # Dev server on port 3456 (clears .stx cache first)
bun run build        # Build pages to static HTML
bun run native       # Native window mode (macOS)
bun run cli          # Run CLI tool
bun run lint         # Lint with pickier
bun run lint:fix     # Auto-fix lint issues
bun run typecheck    # Typecheck across all workspace packages
```

## Architecture

### Monorepo

Bun workspaces. Root app + 6 packages under `packages/`:

| Package | Role |
|---------|------|
| `core` | Shared utilities: path helpers, `isPathSafe()`, `getDirSize()`, plist parsing, `exec()`/`execSync()`, `HOME` constant |
| `clean` | Cleanup logic: caches, logs, browser extensions, DS_Store, trash |
| `uninstall` | Startup item management: launch agents/daemons, toggle/remove |
| `disk` | Recursive directory scanning with size analysis |
| `monitor` | System metrics: CPU, memory, network, battery, GPU, health scoring, process listing |
| `cli` | CLI interface using `@stacksjs/clapp` |

### STX Framework

STX is the full-stack web framework powering this app. It is **not** Alpine.js — STX has its own signals-based reactivity system that provides Alpine-like directive syntax (`x-data`, `x-show`, `x-text`, `@click`, etc.) but is a completely separate implementation using JavaScript Proxy objects.

**Page lifecycle — two execution contexts in every `.stx` page:**

1. **`<script server>`** — Runs at compile/SSR time on the server. Variables declared here are available in template expressions (`{{ var }}`). Use `require()` not `import`. Code is stripped from client output. **Important**: STX pre-compiles all pages at dev startup, so expensive operations here (shell commands, file scanning) block the dev server from starting. Move heavy work to API endpoints and fetch client-side.

2. **`<script data-stx-scoped>`** — Runs in the browser in an isolated scope. Use for DOM manipulation, `fetch()` calls, and functions called from reactive directives. Functions must be attached to `window` to survive SPA navigation.

**Template directives (server-side, evaluated at compile time):**
- `@layout('app')` — wrap page in a layout
- `@section('name')...@endsection` — define content for layout `@yield('name')` slots
- `@include('ComponentName')` — include a component
- `@foreach(items as item)...@endforeach` — server-side loop (static HTML output)
- `@for(let i = 0; i < n; i++)...@endfor` — server-side loop
- `@if(cond)...@elseif...@else...@endif` — server-side conditional
- `{{ expr }}` — HTML-escaped output, `{!! expr !!}` — raw output

**Reactive directives (client-side, STX's own reactivity system):**
- `x-data="{ ... }"` — define a reactive scope with state and methods
- `x-show="expr"` — toggle visibility (element stays in DOM)
- `x-text="expr"` — reactive text content
- `x-html="expr"` — reactive innerHTML
- `x-model="prop"` — two-way binding for inputs
- `x-init="expr"` — run on initialization
- `x-cloak` — hide element until STX reactivity initializes (needs `[x-cloak] { display: none !important; }` in CSS)
- `@click="expr"`, `@submit.prevent="expr"` — event handlers
- `:class="expr"`, `:style="expr"`, `:disabled="expr"` — attribute binding
- `<template x-for="item in items" :key="item.id">` — client-side loop
- `<template x-if="cond">` — client-side conditional (adds/removes from DOM)

**SPA navigation:** Links with `data-stx-link` are intercepted for client-side navigation. STX swaps the `data-stx-content` container, cleans up old scripts, re-executes new `data-stx-scoped` scripts, and uses the View Transitions API for smooth transitions. During navigation, `x-show` elements briefly flash before reactivity initializes — use `x-cloak` on elements that should default to hidden.

**Cross-scope communication pattern:** When `<script data-stx-scoped>` functions need to update `x-data` reactive state, use:
```js
var el = document.querySelector('[data-stx-scope]');
if (el && el.__stx_execute) el.__stx_execute("stateVar = newValue");
```

### Backend

- `@stacksjs/bun-router` for API routing
- `routes/api.ts` auto-discovered — the filename becomes the prefix, so `router.post('/disk-scan', ...)` becomes `POST /api/disk-scan`
- `channels.ts` defines WebSocket broadcast channels (via `ts-broadcasting`). Channels auto-push data at intervals (e.g., `processes` channel every 3s)
- `workers/disk-scan.ts` — Web Worker for blocking disk I/O (avoids blocking the server)
- `stx.config.ts` — STX configuration: component/layout/partial dirs, broadcasting settings, API router instance. The `await router._initApiRoutes()` call here triggers route discovery at startup.

### Key Patterns

- **File-based routing**: `pages/startup.stx` → `/startup`. All pages use `@layout('app')` for the shared chrome (sidebar, status bar).
- **Components**: Auto-registered from `components/` dir. Used via `@include('ComponentName')`.
- **Shell command safety**: API routes use `Bun.spawn()` for shell commands (brew, pantry). Cask tokens are sanitized (`/[^a-z0-9@._+-]/gi`). `isPathSafe()` from core validates paths are within `HOME` before delete/clean operations.
- **Startup performance**: Heavy data-fetching (brew outdated, app sizes via `du`) is done via API endpoints (`/api/updates-check`, `/api/system-apps`) fetched client-side on page load, NOT in `<script server>` blocks which would block dev startup.
