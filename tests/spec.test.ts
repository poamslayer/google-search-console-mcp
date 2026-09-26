import { describe, expect, it } from 'vitest'
import discovery from '../vendor/discovery/searchconsole-v1-20260923.json'
import generated from '../src/spec/spec.generated.json'
import { buildSpec } from '../src/spec/build'
import { NOTES } from '../src/spec/notes'

const spec = buildSpec(discovery, NOTES)

describe('the spec', () => {
  it('pins the vendored revision', () => {
    expect(spec.revision).toBe('20260923')
  })

  it('has the ten live methods and drops the retired Mobile-Friendly Test', () => {
    expect(Object.keys(spec.methods).sort()).toEqual([
      'searchanalytics.query',
      'sitemaps.delete',
      'sitemaps.get',
      'sitemaps.list',
      'sitemaps.submit',
      'sites.add',
      'sites.delete',
      'sites.get',
      'sites.list',
      'urlInspection.index.inspect'
    ])
  })

  it('marks only the four writes as writes, even though two reads use POST', () => {
    const writes = Object.entries(spec.methods)
      .filter(([, m]) => m.write)
      .map(([id]) => id)
      .sort()
    expect(writes).toEqual(['sitemaps.delete', 'sitemaps.submit', 'sites.add', 'sites.delete'])
    expect(spec.methods['searchanalytics.query'].httpMethod).toBe('POST')
    expect(spec.methods['urlInspection.index.inspect'].httpMethod).toBe('POST')
  })

  it('keeps paths relative to the API base', () => {
    expect(spec.methods['searchanalytics.query'].path).toBe(
      'webmasters/v3/sites/{siteUrl}/searchAnalytics/query'
    )
    expect(spec.methods['urlInspection.index.inspect'].path).toBe('v1/urlInspection/index:inspect')
  })

  it('resolves schema references inline', () => {
    const request = spec.methods['searchanalytics.query'].request as {
      properties: Record<string, { items?: { enum?: string[] } }>
    }
    expect(request.properties.dimensions.items?.enum).toContain('QUERY')
    expect(JSON.stringify(spec)).not.toContain('$ref')
  })

  it('attaches notes to the method they describe', () => {
    const notes = spec.methods['searchanalytics.query'].notes.join(' ')
    expect(notes).toMatch(/anonymi[sz]ed/i)
    expect(notes).toMatch(/25,?000/)
    expect(spec.methods['sites.list'].notes.join(' ')).toMatch(/Domain property/)
  })

  it('matches the committed generated file (run npm run spec:build if this fails)', () => {
    expect(generated).toEqual(JSON.parse(JSON.stringify(spec)))
  })
})
