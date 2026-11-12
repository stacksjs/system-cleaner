import * as fs from 'node:fs'
import * as path from 'node:path'

/** Ship application pages and their assets, without the public marketing site. */
export async function stageDesktopWeb(source: string, destination: string): Promise<{ files: number, bytes: number }> {
  const files = [...new Bun.Glob('**/*').scanSync({ cwd: source, onlyFiles: true })]
    .map(file => file.split(path.sep).join('/'))
  // Keep code chunks, including chunks loaded dynamically by the STX runtime.
  const pending = files.filter(file => file === 'app.html' || /\.(?:js|css|json|woff2?|ttf)$/.test(file)
    || file.startsWith('app/') && file.endsWith('.html'))
  if (!pending.includes('app.html') || !pending.some(file => file.endsWith('large-files.html')))
    throw new Error(`No application pages in ${source}`)

  const included = new Set<string>()
  const origin = 'https://desktop.invalid'
  let bytes = 0
  fs.rmSync(destination, { recursive: true, force: true })

  function asset(reference: string, parent: string): void {
    const url = new URL(reference, `${origin}/${parent.split(path.sep).join('/')}`)
    if (url.origin !== origin || url.pathname.startsWith('/api/'))
      return
    const file = decodeURIComponent(url.pathname).replace(/^\//, '')
    const absolute = path.resolve(source, file)
    if (!absolute.startsWith(`${path.resolve(source)}${path.sep}`))
      throw new Error(`Asset escapes web root: ${reference}`)
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile())
      throw new Error(`${parent} references a missing asset: ${reference}`)
    pending.push(file)
  }

  while (pending.length) {
    const file = pending.pop()!
    if (included.has(file))
      continue
    included.add(file)
    const content = fs.readFileSync(path.join(source, file))
    const target = path.join(destination, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    bytes += content.length

    if (file.endsWith('.html')) {
      await new HTMLRewriter()
        .on('script[src], link[rel="stylesheet"][href], link[rel="icon"][href], img[src], source[src]', {
          element(element) {
            const reference = element.getAttribute('src') || element.getAttribute('href')
            if (reference)
              asset(reference, file)
          },
        })
        .transform(new Response(content)).text()
    }
    if (/\.(?:css|html)$/.test(file)) {
      for (const match of content.toString().matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
        if (!match[1].startsWith('#') && !match[1].startsWith('data:'))
          asset(match[1], file)
      }
    }
  }
  return { files: included.size, bytes }
}
