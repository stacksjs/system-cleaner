# Changelog

[Compare changes](https://github.com/stacksjs/system-cleaner/compare/v0.2.1...v0.2.2)

## 🐛 Bug Fixes

- **desktop**: generate the migrations the bundle build assumed were there ([1df5186](https://github.com/stacksjs/system-cleaner/commit/1df5186)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_

[Compare changes](https://github.com/stacksjs/system-cleaner/compare/v0.2.0...v0.2.1)

## 🐛 Bug Fixes

- **ci**: hand the signing certificate to the name the action reads ([0b5c019](https://github.com/stacksjs/system-cleaner/commit/0b5c019)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_

[Compare changes](https://github.com/stacksjs/system-cleaner/compare/v0.1.3...v0.2.0)

## ✨ Features

- **cleanup**: find the 30 GB Quick Clean was walking past ([9dd983f](https://github.com/stacksjs/system-cleaner/commit/9dd983f)) _(by Chris <chrisbreuer93@gmail.com>)_
- **desktop**: the menubar, with the app menu it was missing ([73cc2e5](https://github.com/stacksjs/system-cleaner/commit/73cc2e5)) _(by Chris <chrisbreuer93@gmail.com>)_
- **desktop**: app menu with per-screen shortcuts, and notify long scans ([e9d7bb2](https://github.com/stacksjs/system-cleaner/commit/e9d7bb2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **desktop**: native folder picker and pasteboard ([145aad4](https://github.com/stacksjs/system-cleaner/commit/145aad4)) _(by Chris <chrisbreuer93@gmail.com>)_
- **desktop**: native alerts for every destructive action ([c71c7a2](https://github.com/stacksjs/system-cleaner/commit/c71c7a2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **disk**: right-click a segment for a native menu ([89276db](https://github.com/stacksjs/system-cleaner/commit/89276db)) _(by Chris <chrisbreuer93@gmail.com>)_
- **desktop**: put the Mac's own window buttons in the app's chrome ([0bc79f2](https://github.com/stacksjs/system-cleaner/commit/0bc79f2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **disk**: show what a scan is doing, and say when it is blocked ([c1fe0ec](https://github.com/stacksjs/system-cleaner/commit/c1fe0ec)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: find and bulk-delete large files, and ship a real macOS app ([1f75899](https://github.com/stacksjs/system-cleaner/commit/1f75899)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🐛 Bug Fixes

- **ci**: attach the DMG the release job was silently dropping ([172ca26](https://github.com/stacksjs/system-cleaner/commit/172ca26)) _(by Chris <chrisbreuer93@gmail.com>)_
- **system**: the app detail panel collapsed in a narrow window ([a9de6f6](https://github.com/stacksjs/system-cleaner/commit/a9de6f6)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: the Updates page, the CPU bars, and the numbers around them ([badb79a](https://github.com/stacksjs/system-cleaner/commit/badb79a)) _(by Chris <chrisbreuer93@gmail.com>)_
- **desktop**: sign with entitlements, and a mark that says what the app does ([2be958f](https://github.com/stacksjs/system-cleaner/commit/2be958f)) _(by Chris <chrisbreuer93@gmail.com>)_
- **disk**: drop accelerators the menu does not honour ([530111f](https://github.com/stacksjs/system-cleaner/commit/530111f)) _(by Chris <chrisbreuer93@gmail.com>)_
- **cleanup**: one gated cache silently stopped the whole clean ([3a534c6](https://github.com/stacksjs/system-cleaner/commit/3a534c6)) _(by Chris <chrisbreuer93@gmail.com>)_
- **scans**: leaving a screen threw away the scan it had started ([1b71906](https://github.com/stacksjs/system-cleaner/commit/1b71906)) _(by Chris <chrisbreuer93@gmail.com>)_
- **disk**: a truncated scan reported false proportions, not partial ones ([bd3fd96](https://github.com/stacksjs/system-cleaner/commit/bd3fd96)) _(by Chris <chrisbreuer93@gmail.com>)_
- **cleanup**: spend the danger colour where the danger is ([9a699bd](https://github.com/stacksjs/system-cleaner/commit/9a699bd)) _(by Chris <chrisbreuer93@gmail.com>)_
- **large-files**: stop presenting zeros as findings ([c7b19fa](https://github.com/stacksjs/system-cleaner/commit/c7b19fa)) _(by Chris <chrisbreuer93@gmail.com>)_
- **disk**: a wedged scan leaked a process per attempt ([36c1d32](https://github.com/stacksjs/system-cleaner/commit/36c1d32)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: make Scan Disk work, and say which macOS beta you are on ([334eede](https://github.com/stacksjs/system-cleaner/commit/334eede)) _(by Chris <chrisbreuer93@gmail.com>)_
- **framework**: leave the traffic lights to the platform ([0e9a38a](https://github.com/stacksjs/system-cleaner/commit/0e9a38a)) _(by Chris <chrisbreuer93@gmail.com>)_

## ⚡ Performance Improvements

- **desktop**: one binary instead of three, and 130 MB less of it ([9af6811](https://github.com/stacksjs/system-cleaner/commit/9af6811)) _(by Chris <chrisbreuer93@gmail.com>)_

## ♻️ Code Refactoring

- **desktop**: use the desktop package instead of reimplementing it ([be691a7](https://github.com/stacksjs/system-cleaner/commit/be691a7)) _(by Chris <chrisbreuer93@gmail.com>)_

## 📝 Documentation

- **marketing**: reshoot the showcase, which was two designs out of date ([dcdc99e](https://github.com/stacksjs/system-cleaner/commit/dcdc99e)) _(by Chris <chrisbreuer93@gmail.com>)_
- **disk**: the walker is not the bottleneck, and here is the measurement ([c5bea2d](https://github.com/stacksjs/system-cleaner/commit/c5bea2d)) _(by Chris <chrisbreuer93@gmail.com>)_

## 👷 Build System

- ship signed Craft 0.0.81 runtime ([0bf0def](https://github.com/stacksjs/system-cleaner/commit/0bf0def)) _(by Chris <chrisbreuer93@gmail.com>)_
- track craft 0.0.80 ([8ca436a](https://github.com/stacksjs/system-cleaner/commit/8ca436a)) _(by Chris <chrisbreuer93@gmail.com>)_
- track craft 0.0.79, which carries the native context menu ([60c6bfe](https://github.com/stacksjs/system-cleaner/commit/60c6bfe)) _(by Chris <chrisbreuer93@gmail.com>)_
- **desktop**: package the app with buddy instead of around it ([3f66d3b](https://github.com/stacksjs/system-cleaner/commit/3f66d3b)) _(by Chris <chrisbreuer93@gmail.com>)_

## 💚 Continuous Integration

- install the pantry action that can actually install craft ([d48de74](https://github.com/stacksjs/system-cleaner/commit/d48de74)) _(by Chris <chrisbreuer93@gmail.com>)_
- deliver the Mac App Store build from the release tag ([37a561d](https://github.com/stacksjs/system-cleaner/commit/37a561d)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🔧 Chores

- **deps**: craft 0.0.83, now that the registry has it ([a80e390](https://github.com/stacksjs/system-cleaner/commit/a80e390)) _(by Chris <chrisbreuer93@gmail.com>)_
- **framework**: update Stacks to 0.72.103 ([2e23b9b](https://github.com/stacksjs/system-cleaner/commit/2e23b9b)) _(by Chris <chrisbreuer93@gmail.com>)_
- **framework**: follow the dashboard's window-controls comments ([448c412](https://github.com/stacksjs/system-cleaner/commit/448c412)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([cb72933](https://github.com/stacksjs/system-cleaner/commit/cb72933)) _(by Chris <chrisbreuer93@gmail.com>)_

## ⏪ Reverts

- **desktop**: stop replacing the menubar, which cost more than it added ([a663457](https://github.com/stacksjs/system-cleaner/commit/a663457)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_

[Compare changes](https://github.com/stacksjs/system-cleaner/compare/v0.1.2...v0.1.3)

## 🐛 Bug Fixes

- **cli**: report the released version ([ecc8bbf](https://github.com/stacksjs/system-cleaner/commit/ecc8bbf)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_

[Compare changes](https://github.com/stacksjs/system-cleaner/compare/v0.1.1...v0.1.2)

## 💚 Continuous Integration

- let the pantry action own the release ([674fc4b](https://github.com/stacksjs/system-cleaner/commit/674fc4b)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_

## v0.1.1

## ✨ Features

- **marketing**: surface use cases on the home page ([658e90e](https://github.com/stacksjs/system-cleaner/commit/658e90e)) _(by Chris <chrisbreuer93@gmail.com>)_
- **marketing**: add a Use cases mega menu to the nav ([d93ff85](https://github.com/stacksjs/system-cleaner/commit/d93ff85)) _(by Chris <chrisbreuer93@gmail.com>)_
- **marketing**: add the use case catalog and pages ([e05fcf8](https://github.com/stacksjs/system-cleaner/commit/e05fcf8)) _(by Chris <chrisbreuer93@gmail.com>)_
- **marketing**: land the pending site refresh ([cf9b0cb](https://github.com/stacksjs/system-cleaner/commit/cf9b0cb)) _(by Chris <chrisbreuer93@gmail.com>)_
- **clean**: cover Zig, Deno, Swift PM, and sccache caches ([b2f79e2](https://github.com/stacksjs/system-cleaner/commit/b2f79e2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: replace the source list with an icon rail ([ca75da3](https://github.com/stacksjs/system-cleaner/commit/ca75da3)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: give the activity chart real labelled axes ([ae7ea1b](https://github.com/stacksjs/system-cleaner/commit/ae7ea1b)) _(by Chris <chrisbreuer93@gmail.com>)_
- **marketing**: rebuild product showcase ([14bebb7](https://github.com/stacksjs/system-cleaner/commit/14bebb7)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deploy**: configure shared Hetzner production ([34ef295](https://github.com/stacksjs/system-cleaner/commit/34ef295)) _(by Chris <chrisbreuer93@gmail.com>)_
- **ui**: launch SystemCleaner marketing and macOS shell ([0626c31](https://github.com/stacksjs/system-cleaner/commit/0626c31)) _(by Chris <chrisbreuer93@gmail.com>)_
- **workers**: reuse disk-scan worker across requests ([4ca571a](https://github.com/stacksjs/system-cleaner/commit/4ca571a)) _(by Chris <chrisbreuer93@gmail.com>)_
- **routes**: add cached data APIs and tiered updates check ([7f32614](https://github.com/stacksjs/system-cleaner/commit/7f32614)) _(by Chris <chrisbreuer93@gmail.com>)_
- **core**: add caching, update detection, and fast app listing ([a306614](https://github.com/stacksjs/system-cleaner/commit/a306614)) _(by Chris <chrisbreuer93@gmail.com>)_
- **crosswind**: add config with Apple-system design tokens, migrate TopProcesses ([c9d1f09](https://github.com/stacksjs/system-cleaner/commit/c9d1f09)) _(by Chris <chrisbreuer93@gmail.com>)_
- **core**: add input sanitizers + binary-plist support + execSyncResult ([c4e41ea](https://github.com/stacksjs/system-cleaner/commit/c4e41ea)) _(by Chris <chrisbreuer93@gmail.com>)_
- harden dev wrapper to also clear stale broadcast port ([6180d70](https://github.com/stacksjs/system-cleaner/commit/6180d70)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🐛 Bug Fixes

- **marketing**: only promise what the app and the build actually do ([2ab4bdd](https://github.com/stacksjs/system-cleaner/commit/2ab4bdd)) _(by Chris <chrisbreuer93@gmail.com>)_
- **api**: answer a refused process kill with 403 ([51cb19e](https://github.com/stacksjs/system-cleaner/commit/51cb19e)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: read health and startup counts through methods ([d20d391](https://github.com/stacksjs/system-cleaner/commit/d20d391)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: safelist the icon classes bound at runtime ([4f104b2](https://github.com/stacksjs/system-cleaner/commit/4f104b2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: seed disk panel labels from data attributes ([927fcd2](https://github.com/stacksjs/system-cleaner/commit/927fcd2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: move remaining panels onto the theme tokens ([bac9d26](https://github.com/stacksjs/system-cleaner/commit/bac9d26)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: stop the disk scan totals rendering with quotes ([982d41a](https://github.com/stacksjs/system-cleaner/commit/982d41a)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: render the system app list again ([62e5d48](https://github.com/stacksjs/system-cleaner/commit/62e5d48)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: close the dashboard card grid gaps ([608a13b](https://github.com/stacksjs/system-cleaner/commit/608a13b)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: report boot volume usage in consistent units ([71289be](https://github.com/stacksjs/system-cleaner/commit/71289be)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: unify sidebar iconography on a single blue tint ([8c53c7d](https://github.com/stacksjs/system-cleaner/commit/8c53c7d)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: align macos shell and identity ([f7665fb](https://github.com/stacksjs/system-cleaner/commit/f7665fb)) _(by Chris <chrisbreuer93@gmail.com>)_
- **database**: migrate durable production storage ([09cb47e](https://github.com/stacksjs/system-cleaner/commit/09cb47e)) _(by Chris <chrisbreuer93@gmail.com>)_
- **stx**: render app panels as native components ([2a9ba8f](https://github.com/stacksjs/system-cleaner/commit/2a9ba8f)) _(by Chris <chrisbreuer93@gmail.com>)_
- **ui**: harden native app runtime states ([b81e6f6](https://github.com/stacksjs/system-cleaner/commit/b81e6f6)) _(by Chris <chrisbreuer93@gmail.com>)_
- **tls**: serialize managed certificate issuance ([d9ef690](https://github.com/stacksjs/system-cleaner/commit/d9ef690)) _(by Chris <chrisbreuer93@gmail.com>)_
- **runtime**: align Bun config dependencies ([6a825e4](https://github.com/stacksjs/system-cleaner/commit/6a825e4)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deploy**: require durable shared state support ([d727da0](https://github.com/stacksjs/system-cleaner/commit/d727da0)) _(by Chris <chrisbreuer93@gmail.com>)_
- **lint**: trash unused-vars false-pos; dev regex non-cap; shoot top-level-await ([408c2d0](https://github.com/stacksjs/system-cleaner/commit/408c2d0)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- pickier cleanup (link: deps to ^x.y.z, scanner.ts quotes disable) + kebab staged-lint ([36b6372](https://github.com/stacksjs/system-cleaner/commit/36b6372)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **brittleness**: dsstore mount fences, dynamic vm_stat page size, exact cask match, worker validation ([ca15eb8](https://github.com/stacksjs/system-cleaner/commit/ca15eb8)) _(by Chris <chrisbreuer93@gmail.com>)_
- **ui**: close fetch error holes, hide misleading 'demo' buttons, fix updates page ([4ad29e6](https://github.com/stacksjs/system-cleaner/commit/4ad29e6)) _(by Chris <chrisbreuer93@gmail.com>)_
- **packages**: orphans cap, trash fallback, AppleScript escape, scanner heap, cleaner accuracy, honest disk I/O ([2645be5](https://github.com/stacksjs/system-cleaner/commit/2645be5)) _(by Chris <chrisbreuer93@gmail.com>)_
- **api**: close shell injection + path traversal holes in HTTP routes ([d425e7d](https://github.com/stacksjs/system-cleaner/commit/d425e7d)) _(by Chris <chrisbreuer93@gmail.com>)_
- add setup-bun to publish-commit job ([5bbd6bf](https://github.com/stacksjs/system-cleaner/commit/5bbd6bf)) _(by chrisbreuer <chrisbreuer93@gmail.com>)_
- resolve lint errors ([0d55870](https://github.com/stacksjs/system-cleaner/commit/0d55870)) _(by chrisbreuer <chrisbreuer93@gmail.com>)_

## ⚡ Performance Improvements

- **ui**: fetch heavy page data client-side after load ([6933170](https://github.com/stacksjs/system-cleaner/commit/6933170)) _(by Chris <chrisbreuer93@gmail.com>)_
- **monitor**: list processes with ps -Arc instead of ps aux ([b6e8312](https://github.com/stacksjs/system-cleaner/commit/b6e8312)) _(by Chris <chrisbreuer93@gmail.com>)_

## ♻️ Code Refactoring

- migrate x-text/:text bindings to {{ }} interpolation (#12) ([a1fb5a3](https://github.com/stacksjs/system-cleaner/commit/a1fb5a3)) _(by Glenn Michael Torregosa <gtorregosa@gmail.com>)_ ([#11](https://github.com/stacksjs/system-cleaner/issues/11), [#12](https://github.com/stacksjs/system-cleaner/issues/12), [#12](https://github.com/stacksjs/system-cleaner/issues/12), [#1748](https://github.com/stacksjs/system-cleaner/issues/1748))

## 💄 Styles

- **app**: replace the emoji iconography with Framework7 glyphs ([ec2ebe0](https://github.com/stacksjs/system-cleaner/commit/ec2ebe0)) _(by Chris <chrisbreuer93@gmail.com>)_
- **marketing**: style the use case pages ([6ec10f7](https://github.com/stacksjs/system-cleaner/commit/6ec10f7)) _(by Chris <chrisbreuer93@gmail.com>)_
- **app**: let the rail share the content canvas ([b916e72](https://github.com/stacksjs/system-cleaner/commit/b916e72)) _(by Chris <chrisbreuer93@gmail.com>)_

## ✅ Tests

- scope the runner and cover the catalogs, chart, and clean targets ([cfcd979](https://github.com/stacksjs/system-cleaner/commit/cfcd979)) _(by Chris <chrisbreuer93@gmail.com>)_
- **visual**: cover the use case routes in screenshot proof ([3d681aa](https://github.com/stacksjs/system-cleaner/commit/3d681aa)) _(by Chris <chrisbreuer93@gmail.com>)_
- **visual**: cover the marketing routes in screenshot proof ([3252205](https://github.com/stacksjs/system-cleaner/commit/3252205)) _(by Chris <chrisbreuer93@gmail.com>)_
- **visual**: expand responsive screenshot proof ([c3770ec](https://github.com/stacksjs/system-cleaner/commit/c3770ec)) _(by Chris <chrisbreuer93@gmail.com>)_
- **visual**: capture production launch ([528f58c](https://github.com/stacksjs/system-cleaner/commit/528f58c)) _(by Chris <chrisbreuer93@gmail.com>)_

## 💚 Continuous Integration

- give the linter a scope so CI can pass ([568a464](https://github.com/stacksjs/system-cleaner/commit/568a464)) _(by Chris <chrisbreuer93@gmail.com>)_
- make the release workflow actually produce a release ([939965e](https://github.com/stacksjs/system-cleaner/commit/939965e)) _(by Chris <chrisbreuer93@gmail.com>)_
- drop redundant setup-bun (pantry installs bun via deps.yaml) ([b8941c4](https://github.com/stacksjs/system-cleaner/commit/b8941c4)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🔧 Chores

- **framework**: update Stacks to 0.70.258 ([fef41b8](https://github.com/stacksjs/system-cleaner/commit/fef41b8)) _(by Chris <chrisbreuer93@gmail.com>)_
- **framework**: adopt package-based Stacks runtime ([92dcdcd](https://github.com/stacksjs/system-cleaner/commit/92dcdcd)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: declare bun ^1.3.14 in deps.yaml ([34918a2](https://github.com/stacksjs/system-cleaner/commit/34918a2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.37 ([477b1c4](https://github.com/stacksjs/system-cleaner/commit/477b1c4)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: bump stx and ts-cloud packages to latest ([4a12735](https://github.com/stacksjs/system-cleaner/commit/4a12735)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **config**: move stx.config.ts to config/stx.ts ([dad890c](https://github.com/stacksjs/system-cleaner/commit/dad890c)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **config**: move crosswind.config.ts to config/crosswind.ts ([1c5fb4e](https://github.com/stacksjs/system-cleaner/commit/1c5fb4e)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.35 ([daaf078](https://github.com/stacksjs/system-cleaner/commit/daaf078)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.33 ([68f6dce](https://github.com/stacksjs/system-cleaner/commit/68f6dce)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up @stacksjs/logsmith 0.2.3 ([36a8940](https://github.com/stacksjs/system-cleaner/commit/36a8940)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up buddy-bot 0.9.20 ([8060967](https://github.com/stacksjs/system-cleaner/commit/8060967)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([cfe97a2](https://github.com/stacksjs/system-cleaner/commit/cfe97a2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: sync pantry.lock with package.json version pins ([15e167e](https://github.com/stacksjs/system-cleaner/commit/15e167e)) _(by Chris <chrisbreuer93@gmail.com>)_
- tune dev workflow and CLI update detection ([0a67b24](https://github.com/stacksjs/system-cleaner/commit/0a67b24)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: bump @stacksjs/bun-router to ^0.0.14, @stacksjs/ts-validation to ^0.5.0 ([e7596a3](https://github.com/stacksjs/system-cleaner/commit/e7596a3)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: bump better-dx to ^0.2.15 ([0d2fbf4](https://github.com/stacksjs/system-cleaner/commit/0d2fbf4)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- gitignore dist/, untrack the crosswind.css build artifact ([4647dc6](https://github.com/stacksjs/system-cleaner/commit/4647dc6)) _(by Chris <chrisbreuer93@gmail.com>)_
- **dev**: scripts/dev.ts falls back to bun-hoisted stx when pantry is missing ([8837d34](https://github.com/stacksjs/system-cleaner/commit/8837d34)) _(by Chris <chrisbreuer93@gmail.com>)_
- **infra**: wire up tsconfig + bun:test, fix existing typecheck holes ([fbe515a](https://github.com/stacksjs/system-cleaner/commit/fbe515a)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([23bd123](https://github.com/stacksjs/system-cleaner/commit/23bd123)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([7a8f271](https://github.com/stacksjs/system-cleaner/commit/7a8f271)) _(by Chris <chrisbreuer93@gmail.com>)_
- **ci**: bump actions/checkout to v6, actions/cache to v5 ([753a81b](https://github.com/stacksjs/system-cleaner/commit/753a81b)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock to pick up bun-plugin-dtsx@0.9.18 ([f767441](https://github.com/stacksjs/system-cleaner/commit/f767441)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([57f24a8](https://github.com/stacksjs/system-cleaner/commit/57f24a8)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock and apply pickier --fix ([728c609](https://github.com/stacksjs/system-cleaner/commit/728c609)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock ([cd450a9](https://github.com/stacksjs/system-cleaner/commit/cd450a9)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fresh install to pick up dtsx 0.9.14 and bunfig 0.15.9 ([043f786](https://github.com/stacksjs/system-cleaner/commit/043f786)) _(by chrisbreuer <chrisbreuer93@gmail.com>)_
- fresh install to pick up pickier 0.1.21 ([454befe](https://github.com/stacksjs/system-cleaner/commit/454befe)) _(by chrisbreuer <chrisbreuer93@gmail.com>)_
- gitignore pantry directory ([cad00fd](https://github.com/stacksjs/system-cleaner/commit/cad00fd)) _(by chrisbreuer <chrisbreuer93@gmail.com>)_
- auto-fix lint errors ([9e7af9f](https://github.com/stacksjs/system-cleaner/commit/9e7af9f)) _(by chrisbreuer <chrisbreuer93@gmail.com>)_
- gitignore .stx directory ([4622315](https://github.com/stacksjs/system-cleaner/commit/4622315)) _(by chrisbreuer <chrisbreuer93@gmail.com>)_
- minor updates ([3cd4786](https://github.com/stacksjs/system-cleaner/commit/3cd4786)) _(by chrisbreuer <chrisbreuer93@gmail.com>)_
- wip ([faa2e81](https://github.com/stacksjs/system-cleaner/commit/faa2e81)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([72fe0b5](https://github.com/stacksjs/system-cleaner/commit/72fe0b5)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([c71a3a8](https://github.com/stacksjs/system-cleaner/commit/c71a3a8)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([ce1b44d](https://github.com/stacksjs/system-cleaner/commit/ce1b44d)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([825dd5d](https://github.com/stacksjs/system-cleaner/commit/825dd5d)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([31e0a2b](https://github.com/stacksjs/system-cleaner/commit/31e0a2b)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([2c6eb1e](https://github.com/stacksjs/system-cleaner/commit/2c6eb1e)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([521d391](https://github.com/stacksjs/system-cleaner/commit/521d391)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([3513948](https://github.com/stacksjs/system-cleaner/commit/3513948)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([ad30e6c](https://github.com/stacksjs/system-cleaner/commit/ad30e6c)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([67b9c52](https://github.com/stacksjs/system-cleaner/commit/67b9c52)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([250090d](https://github.com/stacksjs/system-cleaner/commit/250090d)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([b790249](https://github.com/stacksjs/system-cleaner/commit/b790249)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([a81c7b9](https://github.com/stacksjs/system-cleaner/commit/a81c7b9)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([c657265](https://github.com/stacksjs/system-cleaner/commit/c657265)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([1838ea1](https://github.com/stacksjs/system-cleaner/commit/1838ea1)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([847a3c7](https://github.com/stacksjs/system-cleaner/commit/847a3c7)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([3098306](https://github.com/stacksjs/system-cleaner/commit/3098306)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_
- _Glenn Michael Torregosa <gtorregosa@gmail.com>_
- _chrisbreuer <chrisbreuer93@gmail.com>_
- _glennmichael123 <gtorregosa@gmail.com>_
