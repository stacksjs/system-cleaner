# AGENTS.md

Guidance for AI coding agents (Claude Code, OpenAI Codex CLI, Cursor, and others)
working in this Stacks application. Every agent reads this file, so it is the one
place to record project-specific rules.

This is the starter version `buddy setup:ai` writes when a project has no
`AGENTS.md` yet. Edit it freely - it is yours, and it is committed so the whole
team (and every agent) sees the same rules.

---

## Project conventions

### Linting

- Use **pickier**, never eslint directly.
- Lint: `./buddy lint` Auto-fix: `./buddy lint:fix`
- For unused variables, prefer `// eslint-disable-next-line` over an underscore
  prefix.

### Frontend

- Use **stx** for templating. Never vanilla JS (`var`, `document.*`, `window.*`)
  inside stx templates - use signals (`state` / `derived` / `effect`) and
  composables.
- Use **Crosswind** utility classes for styling.
- Icons are Iconify classes (`i-{collection}-{name}`). Never hand-roll SVG paths
  and never add an icon npm package.
- Stacks ships no animation library. Use Crosswind transitions, CSS keyframes,
  scroll-driven animations, and the motion composables.

### `x-data` blocks

Three rules, each learned from a screen that silently rendered every binding
empty with nothing in the console. `tests/xdata-parses.test.ts` enforces the
first two.

1. **No comments inside the literal.** STX collapses the attribute onto one
   line before evaluating it, so a `//` comment swallows the rest of the object.
   Put the commentary in an HTML comment above the element.
2. **No `"` inside the literal.** The attribute is delimited by double quotes.
   Generating markup with `class="..."` ends it early. Use single quotes.
3. **Never mutate reactive state in place.** STX tracks assignment, not
   `Array.prototype.push`/`splice` or a field written on a row object. Build a
   new value and assign it — `this.selected = this.selected.concat([id])`, not
   `this.selected.push(id)`. In-place mutation updates the state and leaves the
   DOM showing the old one.

### Commits

- Conventional commit messages (`fix:`, `feat:`, `chore:`, ...).
- Only commit or push when asked.

### Requirements

Bun >= 1.3.0, SQLite >= 3.47.2, TypeScript throughout.

---

## Repository map

| Path | What lives here |
|---|---|
| `app/` | Your code: `Actions/`, `Jobs/`, `Listeners/`, `Middleware/`, `Mail/`, `Commands/`, `Models/`, `Skills/`, plus `Routes.ts`, `Events.ts`, `Gates.ts`, `Scheduler.ts` |
| `routes/` | Route files, registered via `app/Routes.ts` |
| `config/` | Typed configuration, one file per subsystem |
| `database/` | Migrations, seeders, local SQLite files |
| `resources/` | stx frontend: `views/`, `components/`, `layouts/`, `partials/` |
| `storage/framework/` | Framework internals and defaults. Read-only reference |
| `tests/` | Bun test suites |

### The `app/` override model

Stacks resolves files from `app/` first and falls back to
`storage/framework/defaults/app/`. To customize a framework default, create the
same path under `app/` and it wins.

---

## Skills

The framework ships a skill per subsystem under
`storage/framework/defaults/ai/skills`, each documenting that area
authoritatively. Read the relevant `SKILL.md` before doing non-trivial work
rather than guessing at an API.

Add your own with `app/Skills/<name>/SKILL.md`, then re-run `buddy setup:ai`.

---

## The desktop app

`bun run build:app` produces the signed `.dmg` in
`storage/framework/desktop-dmg/`. It drives buddy rather than replacing it:
`buddy build:views` renders the UI, `buddy build:desktop` compiles the launcher
and bundles Craft, `buddy build:dmg` assembles and images the bundle. The script
does only what the framework cannot know — render the UI as the local agent,
stage the payload, and compile the two binaries the launcher spawns.

Four conventions carry the rest, all read by buddy:

| Path | What it does |
|---|---|
| `app/Desktop/launcher.ts` | replaces the framework launcher, which opens a remote URL this app does not have |
| `app/Desktop/server.ts` | the agent the launcher starts on loopback |
| `app/Desktop/Resources/` | copied into `Contents/Resources` (generated; gitignored) |
| `app/Desktop/Info.plist.json` | the `NS*UsageDescription` strings macOS shows in permission prompts |

Requires Stacks >= 0.72.100. See `docs/guide/desktop-app.md`.

The bundle serves prerendered HTML, so **nothing machine-specific may come from
a `<script server>` block** on an app view. Anything a server script computes is
frozen at build time and will describe the build machine forever. Host facts
travel on `/api/dashboard-stats` and are bound client-side.

## Before finishing

- Lint: `./buddy lint` (fix with `./buddy lint:fix`)
- Type check: `./buddy typecheck`
- Test: `./buddy test`
- Touching an app view or the API? Rebuild and launch the bundle:
  `bun run build:app && open storage/framework/desktop-dist/SystemCleaner.app`
