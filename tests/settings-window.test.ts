import { describe, expect, it } from 'bun:test'

/**
 * The Settings window is three files that have to agree with each other, and
 * nothing at build time makes them.
 *
 *   - `resources/components/SettingsSidebar.stx` declares the rows.
 *   - `resources/views/app/settings.stx` declares the panes.
 *   - `resources/scripts/settings-window.ts` wires the controls.
 *
 * A row whose pane does not exist selects nothing: the click lands, every pane
 * is hidden, and the window shows an empty column under a title that did not
 * change. A pane no row points at can never be reached at all. A switch nobody
 * handles moves under the cursor and forgets. All three look fine in review,
 * because each file is correct on its own.
 */

const SIDEBAR = 'resources/components/SettingsSidebar.stx'
const VIEW = 'resources/views/app/settings.stx'
const SCRIPT = 'resources/scripts/settings-window.ts'
const OPENER = 'resources/scripts/settings-panel.ts'
const LAYOUT = 'resources/layouts/settings.stx'

async function read(file: string): Promise<string> {
  return Bun.file(file).text()
}

/** Every value of an attribute, in source order. */
function attributeValues(source: string, attribute: string): string[] {
  const found: string[] = []
  // Both quote styles: the templates use single quotes, the script's selectors
  // use double.
  for (const match of source.matchAll(new RegExp(`${attribute}=['"]([^'"]+)['"]`, 'g')))
    found.push(match[1])
  return found
}

describe('the Settings window', () => {
  it('has a pane for every sidebar row, and a row for every pane', async () => {
    const sidebar = await read(SIDEBAR)
    const view = await read(VIEW)

    // The rows are declared in a server block as `{ id: 'general', … }`, and
    // the alert row points at one by `data-pane-link` in the markup.
    const rowIds = new Set<string>()
    for (const match of sidebar.matchAll(/\{ id: '([a-z-]+)'/g))
      rowIds.add(match[1])
    for (const value of attributeValues(sidebar, 'data-pane-link')) {
      // The `@foreach` writes `data-pane-link='{{ item.id }}'`; the ids it
      // interpolates are the ones already collected above.
      if (!value.includes('{{'))
        rowIds.add(value)
    }

    const paneIds = new Set(attributeValues(view, 'data-pane'))

    expect(rowIds.size).toBeGreaterThan(0)
    expect([...rowIds].filter(id => !paneIds.has(id))).toEqual([])
    expect([...paneIds].filter(id => !rowIds.has(id))).toEqual([])
  })

  it('gives every pane a title for the toolbar', async () => {
    const view = await read(VIEW)

    const untitled: string[] = []
    for (const match of view.matchAll(/data-pane='([a-z-]+)'([^>]*)>/g)) {
      if (!match[2].includes('data-pane-title='))
        untitled.push(match[1])
    }

    // Without one the toolbar falls back to the pane's id, which is a
    // lowercase slug where a person expects a name.
    expect(untitled).toEqual([])
  })

  it('handles every switch and select the panes declare', async () => {
    const view = await read(VIEW)
    const script = await read(SCRIPT)

    // Either as a branch of its own (`id === 'scheduleEnabled'`) or as a key of
    // `PREF_DEFAULTS`, which is the plain-boolean case.
    const handled = (id: string) => script.includes(`'${id}'`) || new RegExp(`^\\s{2}${id}:`, 'm').test(script)

    const unhandled = attributeValues(view, 'data-switch')
      // `analytics` is deliberately inert — the row exists to say there is no
      // analytics, and the control is disabled in the markup.
      .filter(id => id !== 'analytics')
      .filter(id => !handled(id))

    expect(unhandled).toEqual([])

    const unhandledSelects = attributeValues(view, 'data-select')
      .filter(id => !script.includes(`'${id}'`))

    expect(unhandledSelects).toEqual([])
  })

  it('reaches an endpoint for every button that claims to do something', async () => {
    const view = await read(VIEW)
    const script = await read(SCRIPT)

    const unhandled = attributeValues(view, 'data-action')
      .filter(action => !script.includes(`'${action}'`))

    expect(unhandled).toEqual([])
  })

  it('asks for a material behind the whole view, not behind a leading strip', async () => {
    const opener = await read(OPENER)

    // Craft's sidebar-span material is pinned to `NSAppearanceNameVibrantLight`
    // and washed with a fixed light tint, so a Settings window that asked for
    // it would keep a pale sidebar in dark mode. The window span carries no
    // colour, which leaves both surfaces to the page's own tokens.
    expect(opener).toContain('webWindowMaterial: true')
    expect(opener).not.toContain('webSidebarMaterial:')
  })

  it('draws its own history row, so Craft does not draw a second one', async () => {
    const opener = await read(OPENER)
    const layout = await read(LAYOUT)

    // Craft puts a sidebar toggle and two history arrows beside the window
    // buttons on any window with a web material. This one has its own pair in
    // the detail pane's toolbar, and two pairs in one window mean two
    // different things by the same glyph.
    expect(opener).toContain('chromeControls: false')
    expect(layout).toContain('data-history-back')
  })

  it('opens under a name, so a second Cmd+, does not open a second window', async () => {
    const opener = await read(OPENER)

    // Craft keys "is this window already open?" on the name. Without one the
    // runtime has nothing to match against and every Cmd+, builds another
    // Settings window behind the last.
    expect(opener).toContain('name: SETTINGS_WINDOW')
    expect(opener).toMatch(/const SETTINGS_WINDOW = '[a-z-]+'/)
  })

  it('never reintroduces the modal it replaced', async () => {
    // The sheet is gone from `layouts/app.stx`; a stray reference to it would
    // be a component that no longer exists, which STX renders as nothing at
    // all rather than as an error.
    const appLayout = await read('resources/layouts/app.stx')
    expect(appLayout).not.toContain('<SettingsPanel')
    expect(appLayout).not.toContain('settings-scrim')
  })
})
