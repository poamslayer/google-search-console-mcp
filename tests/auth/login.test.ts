import { exports } from 'cloudflare:workers'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../setup/msw'
import { callTool, listTools, toolText } from '../helpers/mcp'
import { FULL_SCOPE, ORIGIN, READ_ONLY_SCOPE, beginLogin, login } from '../helpers/auth'

const API = 'https://searchconsole.googleapis.com'
const SITEMAP_PATH = `webmasters/v3/sites/${encodeURIComponent('sc-domain:example.com')}/sitemaps/${encodeURIComponent('https://example.com/sitemap.xml')}`

describe('Google login', () => {
  it('refuses /mcp without a token', async () => {
    const res = await exports.default.fetch(
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: { Host: 'localhost', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      })
    )
    expect(res.status).toBe(401)
  })

  it('sends a read-only login to Google with offline access and PKCE', async () => {
    const { googleAuthorizeUrl } = await beginLogin('read-only')
    expect(googleAuthorizeUrl.origin + googleAuthorizeUrl.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const params = googleAuthorizeUrl.searchParams
    expect(params.get('client_id')).toBe('test-client-id.apps.googleusercontent.com')
    expect(params.get('redirect_uri')).toBe(`${ORIGIN}/oauth/callback`)
    expect(params.get('scope')?.split(' ').sort()).toEqual(['email', 'openid', READ_ONLY_SCOPE].sort())
    expect(params.get('access_type')).toBe('offline')
    expect(params.get('prompt')).toBe('consent')
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('code_challenge')).toBeTruthy()
  })

  it('asks Google for the full scope when the user picks full access', async () => {
    const { googleAuthorizeUrl } = await beginLogin('full')
    expect(googleAuthorizeUrl.searchParams.get('scope')?.split(' ')).toContain(FULL_SCOPE)
    expect(googleAuthorizeUrl.searchParams.get('scope')?.split(' ')).not.toContain(READ_ONLY_SCOPE)
  })

  it('rejects a callback that is not bound to the browser that started the login', async () => {
    const { googleAuthorizeUrl } = await beginLogin('read-only')
    const res = await exports.default.fetch(
      new Request(`${ORIGIN}/oauth/callback?code=x&state=${googleAuthorizeUrl.searchParams.get('state')}`, {
        redirect: 'manual'
      })
    )
    expect(res.status).toBe(400)
  })

  it('issues an MCP token that works, and sends the Google token from login to the API', async () => {
    const { accessToken } = await login({ googleAccessToken: 'google-token-from-login' })
    expect((await listTools(accessToken)).result?.tools?.map((t) => t.name).sort()).toEqual(['execute', 'search'])

    let authorization: string | null = null
    server.use(
      http.get(`${API}/webmasters/v3/sites`, ({ request }) => {
        authorization = request.headers.get('Authorization')
        return HttpResponse.json({ siteEntry: [] })
      })
    )
    const result = await callTool('execute', { code: `async () => gsc.request({ path: "webmasters/v3/sites" })` }, accessToken)
    expect(result.result?.isError).toBeFalsy()
    expect(authorization).toBe('Bearer google-token-from-login')
  })
})

describe('access levels', () => {
  it('refuses a write for a read-only login without sending it', async () => {
    const { accessToken } = await login({ accessLevel: 'read-only' })
    let sent = false
    server.use(http.put(`${API}/${SITEMAP_PATH}`, () => { sent = true; return new HttpResponse(null, { status: 204 }) }))
    const result = await callTool('execute', { code: `async () => gsc.request({ method: "PUT", path: "${SITEMAP_PATH}" })` }, accessToken)
    expect(sent).toBe(false)
    expect(result.result?.isError).toBe(true)
    expect(toolText(result)).toContain('Your login is read-only')
  })

  it('treats a full-access login as read-only when the user unticks the scope at Google', async () => {
    const { accessToken } = await login({ accessLevel: 'full', grantedScope: READ_ONLY_SCOPE })
    const result = await callTool('execute', { code: `async () => gsc.request({ method: "PUT", path: "${SITEMAP_PATH}" })` }, accessToken)
    expect(toolText(result)).toContain('Your login is read-only')
  })

  it('sends a write for a full-access login and records it', async () => {
    const { accessToken } = await login({ accessLevel: 'full' })
    server.use(http.put(`${API}/${SITEMAP_PATH}`, () => new HttpResponse(null, { status: 204 })))
    const result = await callTool('execute', {
      code: `async () => { await gsc.request({ method: "PUT", path: "${SITEMAP_PATH}" }); return "submitted" }`
    }, accessToken)
    expect(result.result?.isError).toBeFalsy()
    const body = JSON.parse(toolText(result))
    expect(body.result).toBe('submitted')
    expect(body.callRecord).toEqual([
      { methodId: 'sitemaps.submit', httpMethod: 'PUT', property: 'sc-domain:example.com', write: true, status: 'succeeded', httpStatus: 204 }
    ])
  })

  it('stops a run after 5 writes', async () => {
    const { accessToken } = await login({ accessLevel: 'full' })
    let sent = 0
    server.use(http.put(`${API}/${SITEMAP_PATH}`, () => { sent++; return new HttpResponse(null, { status: 204 }) }))
    const result = await callTool('execute', {
      code: `async () => { for (let i = 0; i < 6; i++) await gsc.request({ method: "PUT", path: "${SITEMAP_PATH}" }); return "all 6" }`
    }, accessToken)
    expect(sent).toBe(5)
    expect(result.result?.isError).toBe(true)
    expect(toolText(result)).toContain('at most 5 writes')
  })
})
