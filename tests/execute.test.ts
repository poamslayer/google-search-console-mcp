import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from './setup/msw'
import { callTool, toolText } from './helpers/mcp'

const API = 'https://searchconsole.googleapis.com'

async function execute(code: string) {
  const result = await callTool('execute', { code })
  return { result, text: toolText(result) }
}

describe('the execute tool', () => {
  it('returns the result and a call record kept by the host', async () => {
    let authorization: string | null = null
    server.use(
      http.get(`${API}/webmasters/v3/sites`, ({ request }) => {
        authorization = request.headers.get('Authorization')
        return HttpResponse.json({
          siteEntry: [{ siteUrl: 'sc-domain:vividtc.com', permissionLevel: 'siteOwner' }]
        })
      })
    )

    const { result, text } = await execute(
      `async () => (await gsc.request({ method: "GET", path: "webmasters/v3/sites" })).siteEntry.map((s) => s.siteUrl)`
    )

    expect(result.result?.isError).toBeFalsy()
    const body = JSON.parse(text)
    expect(body.result).toEqual(['sc-domain:vividtc.com'])
    expect(body.callRecord).toEqual([
      {
        methodId: 'sites.list',
        httpMethod: 'GET',
        property: null,
        write: false,
        status: 'succeeded',
        httpStatus: 200
      }
    ])
    expect(authorization).toBe('Bearer test-access-token')
  })

  it('never gives the code the token', async () => {
    const { text } = await execute(
      `async () => JSON.stringify({ env: typeof env, globals: Object.keys(globalThis) })`
    )
    expect(text).not.toContain('test-access-token')
  })

  it('turns a Google error into a tool error with a failed entry', async () => {
    server.use(
      http.get(`${API}/webmasters/v3/sites/sc-domain%3Aother.com`, () =>
        HttpResponse.json(
          { error: { code: 403, message: "User does not have sufficient permission for site 'sc-domain:other.com'." } },
          { status: 403 }
        )
      )
    )
    const { result, text } = await execute(
      `async () => gsc.request({ path: "webmasters/v3/sites/" + encodeURIComponent("sc-domain:other.com") })`
    )
    expect(result.result?.isError).toBe(true)
    expect(text).toContain('Search Console API error 403: User does not have sufficient permission')
    expect(text).toContain('"status": "failed"')
    expect(text).toContain('"property": "sc-domain:other.com"')
  })

  it('refuses a write without sending it', async () => {
    let sent = false
    server.use(
      http.put(`${API}/webmasters/v3/sites/:site/sitemaps/:feed`, () => {
        sent = true
        return new HttpResponse(null, { status: 204 })
      })
    )
    const { result, text } = await execute(`async () => gsc.request({
      method: "PUT",
      path: "webmasters/v3/sites/" + encodeURIComponent("sc-domain:vividtc.com") + "/sitemaps/" + encodeURIComponent("https://vividtc.com/sitemap.xml")
    })`)
    expect(sent).toBe(false)
    expect(result.result?.isError).toBe(true)
    expect(text).toContain('sitemaps.submit changes data')
    expect(text).toContain('"status": "rejected"')
    expect(text).toContain('"write": true')
  })

  it('refuses hosts other than the Search Console API', async () => {
    const { result, text } = await execute(
      `async () => (await fetch("https://example.com/steal")).status`
    )
    expect(text).not.toContain('test-access-token')
    const body = result.result?.isError ? text : JSON.parse(text)
    expect(JSON.stringify(body)).toContain('requests to example.com are not allowed')
  })

  it('refuses a path that is not in the spec', async () => {
    const { result, text } = await execute(`async () => gsc.request({ path: "webmasters/v3/users" })`)
    expect(result.result?.isError).toBe(true)
    expect(text).toContain('is not a Search Console API method')
  })

  it('stops a run after 50 requests', async () => {
    let count = 0
    server.use(
      http.get(`${API}/webmasters/v3/sites`, () => {
        count++
        return HttpResponse.json({ siteEntry: [] })
      })
    )
    const { result, text } = await execute(`async () => {
      for (let i = 0; i < 60; i++) await gsc.request({ path: "webmasters/v3/sites" });
      return "finished all 60";
    }`)
    expect(result.result?.isError).toBe(true)
    expect(text).not.toContain('finished all 60')
    expect(text).toContain('at most 50 requests')
    expect(count).toBe(50)
  })

  it('ends code that waits on nothing', async () => {
    const { result } = await execute(`async () => { await new Promise(() => {}); }`)
    expect(result.result?.isError).toBe(true)
  })

  it('stops a run that waits past the time limit', async () => {
    const { result, text } = await execute(
      `async () => { await new Promise((resolve) => setTimeout(resolve, 120000)); return "waited" }`
    )
    expect(result.result?.isError).toBe(true)
    expect(text).toMatch(/timed out/i)
  })
})
