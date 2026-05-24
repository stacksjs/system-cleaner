import { describe, expect, it } from 'bun:test'
import { TtlCache, singleFlight } from '../src/cache'

describe('TtlCache', () => {
  it('returns undefined for missing keys', () => {
    const cache = new TtlCache<string>(1000)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('expires entries after TTL', async () => {
    const cache = new TtlCache<string>(50)
    cache.set('k', 'v')
    expect(cache.get('k')).toBe('v')
    await Bun.sleep(60)
    expect(cache.get('k')).toBeUndefined()
  })
})

describe('singleFlight', () => {
  it('dedupes concurrent calls', async () => {
    let calls = 0
    const work = () => {
      calls++
      return Promise.resolve('ok')
    }
    const [a, b] = await Promise.all([
      singleFlight('test', work),
      singleFlight('test', work),
    ])
    expect(a).toBe('ok')
    expect(b).toBe('ok')
    expect(calls).toBe(1)
  })
})
