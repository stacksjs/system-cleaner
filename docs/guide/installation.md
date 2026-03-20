---
title: Installation
---

# Installation

## Prerequisites

- [Bun](https://bun.sh) >= 1.3
- macOS (the system scanning APIs target macOS paths)

## Setup

```bash
git clone <repo-url> system-cleaner
cd system-cleaner
bun install
```

This installs `bun-plugin-stx` (runtime) and `better-dx` (dev tooling including bunpress, pickier, TypeScript, etc.).

## Development

```bash
bun run dev        # Starts stx dev server on http://localhost:3456
bun run native     # Opens in a Craft desktop window
```

## Build

```bash
bun run build      # Static build to dist/
```

## Documentation

```bash
bun run dev:docs      # bunpress dev server for these docs
bun run build:docs    # Static docs build
```
