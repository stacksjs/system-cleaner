import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { stageDesktopWeb } from '../scripts/desktop-resources'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

function fixture(): { source: string, destination: string, write: (file: string, content: string) => void } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-resources-'))
  directories.push(directory)
  const source = path.join(directory, 'rendered')
  const destination = path.join(directory, 'bundle')
  return {
    source,
    destination,
    write(file, content) {
      const target = path.join(source, file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content)
    },
  }
}

describe('desktop web payload', () => {
  it('keeps app dependencies and dynamic runtime chunks, without shipping the marketing site', async () => {
    const { source, destination, write } = fixture()
    write('app.html', '<a href="/app/large-files">Large files</a>')
    write('app/large-files.html', '<link rel="stylesheet" href="/theme.css"><img src="/images/mark.svg"><img src="/api/app-icon?name=Finder">')
    write('theme.css', 'body { background-image: url(./images/pattern.svg); }')
    write('images/mark.svg', '<svg/>')
    write('images/pattern.svg', '<svg/>')
    write('_stx/lazy.js', 'globalThis.loaded = true')
    write('index.html', '<img src="/images/showcase.png">')
    write('images/showcase.png', 'marketing screenshot')
    const result = await stageDesktopWeb(source, destination)
    expect(result.files).toBe(6)
    expect(fs.existsSync(path.join(destination, 'app.html'))).toBe(true)
    expect(fs.existsSync(path.join(destination, 'images/mark.svg'))).toBe(true)
    expect(fs.existsSync(path.join(destination, 'images/pattern.svg'))).toBe(true)
    expect(fs.existsSync(path.join(destination, '_stx/lazy.js'))).toBe(true)
    expect(fs.existsSync(path.join(destination, 'index.html'))).toBe(false)
    expect(fs.existsSync(path.join(destination, 'images/showcase.png'))).toBe(false)
    const written = [...new Bun.Glob('**/*').scanSync({ cwd: destination, onlyFiles: true })]
    expect(result.bytes).toBe(written.reduce((sum, file) => sum + fs.statSync(path.join(destination, file)).size, 0))
  })

  it('rejects an asset omitted by the renderer instead of shipping a broken page', async () => {
    const { source, destination, write } = fixture()
    write('app.html', '<a href="/app/large-files">Large files</a>')
    write('app/large-files.html', '<script src="/missing.js"></script>')
    expect(stageDesktopWeb(source, destination)).rejects.toThrow('missing asset')
  })

  it('rejects a render containing only marketing pages', async () => {
    const { source, destination, write } = fixture()
    write('index.html', 'Download the app')
    expect(stageDesktopWeb(source, destination)).rejects.toThrow('No application pages')
  })
})
