import { describe, expect, it } from 'vitest'
import { callTool, listTools, toolText } from './helpers/mcp'

describe('the search tool', () => {
  it('is listed as a tool', async () => {
    const result = await listTools()
    expect(result.result?.tools?.map((tool) => tool.name)).toContain('search')
  })

  it('returns a method with its notes', async () => {
    const result = await callTool('search', {
      code: `async () => spec.methods['searchanalytics.query']`
    })
    expect(result.result?.isError).toBeFalsy()
    const method = JSON.parse(toolText(result))
    expect(method.path).toBe('webmasters/v3/sites/{siteUrl}/searchAnalytics/query')
    expect(method.notes.join(' ')).toMatch(/anonymised/)
  })

  it('lets the code filter the spec', async () => {
    const result = await callTool('search', {
      code: `async () => Object.entries(spec.methods).filter(([, m]) => m.write).map(([id]) => id)`
    })
    expect(JSON.parse(toolText(result)).sort()).toEqual([
      'sitemaps.delete',
      'sitemaps.submit',
      'sites.add',
      'sites.delete'
    ])
  })

  it('has no network access', async () => {
    const result = await callTool('search', {
      code: `async () => { await fetch("https://searchconsole.googleapis.com/webmasters/v3/sites"); return "reached the network" }`
    })
    expect(result.result?.isError).toBe(true)
    expect(toolText(result)).not.toContain('reached the network')
  })

  it('reports an error thrown by the code', async () => {
    const result = await callTool('search', { code: `async () => { throw new Error("no such method") }` })
    expect(result.result?.isError).toBe(true)
    expect(toolText(result)).toContain('no such method')
  })
})
