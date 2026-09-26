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
})
