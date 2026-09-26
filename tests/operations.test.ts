import { describe, expect, it } from 'vitest'
import { matchOperation } from '../src/spec/operations'

describe('matchOperation', () => {
  it('matches a path with no property', () => {
    expect(matchOperation('GET', 'webmasters/v3/sites')).toEqual({
      methodId: 'sites.list',
      write: false,
      property: undefined
    })
  })

  it('matches a read that uses POST and decodes a Domain property', () => {
    expect(
      matchOperation('POST', 'webmasters/v3/sites/sc-domain%3Avividtc.com/searchAnalytics/query')
    ).toEqual({ methodId: 'searchanalytics.query', write: false, property: 'sc-domain:vividtc.com' })
  })

  it('decodes a URL-prefix property and tells a sitemap read from a sitemap write', () => {
    const path =
      'webmasters/v3/sites/https%3A%2F%2Fvividtc.com%2F/sitemaps/https%3A%2F%2Fvividtc.com%2Fsitemap.xml'
    expect(matchOperation('GET', path)).toEqual({
      methodId: 'sitemaps.get',
      write: false,
      property: 'https://vividtc.com/'
    })
    expect(matchOperation('PUT', path)?.methodId).toBe('sitemaps.submit')
    expect(matchOperation('PUT', path)?.write).toBe(true)
  })

  it('tells sites.get from sites.delete by HTTP method', () => {
    expect(matchOperation('GET', 'webmasters/v3/sites/sc-domain%3Avividtc.com')?.methodId).toBe('sites.get')
    expect(matchOperation('DELETE', 'webmasters/v3/sites/sc-domain%3Avividtc.com')).toEqual({
      methodId: 'sites.delete',
      write: true,
      property: 'sc-domain:vividtc.com'
    })
  })

  it('matches URL inspection with the colon written plainly or encoded', () => {
    expect(matchOperation('POST', 'v1/urlInspection/index:inspect')?.methodId).toBe(
      'urlInspection.index.inspect'
    )
    expect(matchOperation('POST', '/v1/urlInspection/index%3Ainspect')?.methodId).toBe(
      'urlInspection.index.inspect'
    )
  })

  it('rejects anything not in the spec', () => {
    expect(matchOperation('DELETE', 'webmasters/v3/sites')).toBeUndefined()
    expect(matchOperation('GET', 'webmasters/v3/users')).toBeUndefined()
    expect(matchOperation('POST', 'v1/urlTestingTools/mobileFriendlyTest:run')).toBeUndefined()
  })

  it('rejects a property that was not URL-encoded', () => {
    expect(matchOperation('GET', 'webmasters/v3/sites/https://vividtc.com/')).toBeUndefined()
  })
})
