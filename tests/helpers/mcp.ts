// Adapted from cloudflare/mcp tests/helpers/mcp.ts (Apache-2.0). Modified by Arnold De La Vega.
import { exports } from 'cloudflare:workers'

export const MCP_URL = 'http://localhost/mcp'

/** Result envelope of an MCP request over Streamable HTTP. */
export interface McpResult {
  result?: {
    content?: Array<{ type: string; text: string }>
    isError?: boolean
    tools?: Array<{ name: string; annotations?: Record<string, unknown> }>
  }
  error?: { code: number; message: string }
}

function rpc(method: string, params?: Record<string, unknown>): Request {
  return new Request(MCP_URL, {
    method: 'POST',
    headers: {
      Host: 'localhost',
      'Content-Type': 'application/json',
      // Streamable HTTP requires the client to accept both content types.
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
}

/** Parse a Streamable HTTP response, which may be JSON or an SSE `data:` frame. */
async function parse(res: Response): Promise<McpResult> {
  const text = await res.text()
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'))
    return JSON.parse(dataLine!.slice('data:'.length).trim())
  }
  return JSON.parse(text)
}

export async function initialize(): Promise<McpResult & { result?: { serverInfo?: { name: string } } }> {
  return parse(
    await exports.default.fetch(
      rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'gsc-mcp-tests', version: '1.0.0' }
      })
    )
  )
}

export async function listTools(): Promise<McpResult> {
  return parse(await exports.default.fetch(rpc('tools/list')))
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<McpResult> {
  return parse(await exports.default.fetch(rpc('tools/call', { name, arguments: args })))
}

/** The text of the first content block. */
export function toolText(result: McpResult): string {
  return result.result?.content?.[0]?.text ?? ''
}
