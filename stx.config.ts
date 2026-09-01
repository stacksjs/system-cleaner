/**
 * Configuration read by the stx CLI itself.
 *
 * `config/ui.ts` is a Stacks-level file: the framework reads it, the stx binary
 * does not. `buddy build:views` shells out to `stx build`, which loads
 * `stx.config.ts` (or `.config/stx.ts`) and nothing else — so the `router`
 * block in `config/ui.ts` never reached the static build, and the injected
 * router fell back to its own defaults.
 *
 * Only the router block is set here. Everything else stx needs — the
 * `resources` root, the component and layout directories — it infers correctly
 * from the project layout, and pinning those would be one more thing to keep in
 * sync for no gain.
 */
export default {
  router: {
    // The shell renders the rail and the top bar once and marks the routed
    // region; swapping only that is what keeps the nav mounted across a
    // navigation instead of rebuilding it on every click.
    container: '[data-stx-content]',
    viewTransitions: true,
    scrollToTop: true,
    prefetch: true,
  },
}
