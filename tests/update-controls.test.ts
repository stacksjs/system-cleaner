import { expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as vm from 'node:vm'

interface Controls {
  self: { stage: string, currentVersion: string, latestVersion: string | null, error: string | null }
  selfActionBusy: boolean
  selfPollTimer: number | null
  installSelfUpdate: () => Promise<void>
}

function controls(confirm: () => Promise<boolean>, install: () => Response) {
  const calls: string[] = []
  const host: { updatesXData?: () => Controls, nativeConfirm: typeof confirm } = { nativeConfirm: confirm }
  vm.runInNewContext(fs.readFileSync('public/updates-xdata.js', 'utf8'), {
    window: host, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1,
    fetch: async (url: string) => { calls.push(url); return install() },
  })
  const state = host.updatesXData!()
  state.self = { ...state.self, stage: 'ready', currentVersion: '0.3.19', latestVersion: '0.3.20' }
  return { state, calls }
}
it('Restart to Install submits the install and disables duplicate requests', async () => {
  let confirm!: (answer: boolean) => void
  const { state, calls } = controls(() => new Promise(resolve => { confirm = resolve }),
    () => Response.json({ success: true, stage: 'installing' }))
  const installing = state.installSelfUpdate()
  expect(state.selfActionBusy).toBe(true)
  await state.installSelfUpdate()
  expect(calls).toHaveLength(0)
  confirm(true)
  await installing
  expect(calls).toEqual(['/api/self-update/install'])
  expect(state.self.stage).toBe('installing')
  await state.installSelfUpdate()
  expect(calls).toHaveLength(1)
})
it('declining the restart keeps the downloaded update ready', async () => {
  const { state, calls } = controls(async () => false, () => Response.json({ success: true }))
  await state.installSelfUpdate()
  expect(calls).toHaveLength(0)
  expect(state.self.stage).toBe('ready')
  expect(state.selfActionBusy).toBe(false)
})
it('shows confirmation and HTTP failures in update state instead of dropping the click', async () => {
  const brokenDialog = controls(async () => { throw new Error('Native dialog failed') }, () => Response.json({ success: true }))
  await brokenDialog.state.installSelfUpdate()
  expect(brokenDialog.state.self).toMatchObject({ stage: 'error', error: 'Native dialog failed' })
  const failedInstall = controls(async () => true, () => Response.json({ success: false, error: 'Bundle cannot be replaced' }, { status: 500 }))
  await failedInstall.state.installSelfUpdate()
  expect(failedInstall.state.self).toMatchObject({ stage: 'error', error: 'Bundle cannot be replaced' })
  expect(failedInstall.state.selfPollTimer).toBe(null)
})
it('loads the shared native dialogs in the separate Settings window', () => {
  const layout = fs.readFileSync('resources/layouts/settings.stx', 'utf8')
  expect(layout).toContain('src="/native-dialog.js"')
})
