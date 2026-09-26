import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import spec from '../spec/spec.generated.json'
import { formatError } from '../errors'
import { runInSandbox } from '../sandbox'
import { truncateResponse } from '../truncate'

const SPEC_JSON = JSON.stringify(spec)

const DESCRIPTION = `Search the Google Search Console API spec by writing JavaScript. Use this before execute, to find the method, its parameters and its notes.

Your code runs with no network access and can read:

declare const spec: {
  revision: string
  methods: Record<string, {   // keyed by method id, e.g. "searchanalytics.query"
    httpMethod: "GET" | "POST" | "PUT" | "DELETE"
    path: string              // relative to the API base, e.g. "webmasters/v3/sites/{siteUrl}"
    description: string
    parameters: Record<string, { type: string; location: "path" | "query"; required?: boolean; description?: string }>
    request?: object          // JSON schema of the request body
    response?: object         // JSON schema of the response
    scopes: string[]
    write: boolean            // true only for sites.add, sites.delete, sitemaps.submit, sitemaps.delete
    notes: string[]           // behaviour the API reference does not state; read these before calling
  }>
}

Your code must be an async arrow function that returns the result. Examples:

async () => Object.entries(spec.methods).map(([id, m]) => ({ id, httpMethod: m.httpMethod, path: m.path }))

async () => spec.methods["searchanalytics.query"]`

/** Register the search tool (ADR-0001, ADR-0004). */
export function registerSearchTool(server: McpServer, loader: WorkerLoader): void {
  server.registerTool(
    'search',
    {
      title: 'Search Console API spec search',
      description: DESCRIPTION,
      inputSchema: z.object({
        code: z.string().describe('JavaScript async arrow function to search the spec')
      }),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
    },
    async ({ code }) => {
      try {
        const result = await runInSandbox(loader, {
          code,
          prelude: `const spec = ${SPEC_JSON};`,
          globalOutbound: null
        })
        return { content: [{ type: 'text', text: truncateResponse(result) }] }
      } catch (error) {
        return formatError(error)
      }
    }
  )
}
