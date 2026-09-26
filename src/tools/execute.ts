// The outbound entrypoint and the sandbox request helper are adapted from
// cloudflare/mcp src/tools/execute.ts (Apache-2.0). Modified by Arnold De La Vega.
import { WorkerEntrypoint, exports } from 'cloudflare:workers'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { addEntry, closeRun, entryCount, openRun, updateEntry, type CallRecordEntry } from '../call-record'
import { formatError } from '../errors'
import { runInSandbox } from '../sandbox'
import { matchOperation } from '../spec/operations'
import { MAX_CHARS, shrinkToFit } from '../truncate'

type OutboundProps = { token: string; runId: string }

/**
 * Execution limits for one run (ADR-0005). This entrypoint enforces the
 * request cap itself, because the runtime's own subRequests limit is not
 * enforced in local development and so cannot be tested. The CPU limit is left
 * to the runtime. The wall time comes from EXECUTE_TIMEOUT_MS.
 */
export const MAX_REQUESTS = 50
const RUNTIME_LIMITS = { cpuMs: 10_000 }

/**
 * Every fetch() from an execute sandbox arrives here. It refuses other hosts,
 * anything the spec does not list, and (in this slice) every write. It adds
 * the user's token, which never enters the sandbox, and records each request.
 */
export class GscOutbound extends WorkerEntrypoint<Env, OutboundProps> {
  async fetch(request: Request): Promise<Response> {
    const { token, runId } = this.ctx.props
    const base = new URL(this.env.GSC_API_BASE)
    const url = new URL(request.url)

    const rejected = { httpMethod: request.method, write: false, status: 'rejected' as const }
    if (entryCount(runId) >= MAX_REQUESTS) {
      addEntry(runId, { ...rejected, methodId: null, property: null, reason: 'request limit reached' })
      return refuse(`One run may send at most ${MAX_REQUESTS} requests.`)
    }
    if (url.host !== base.host) {
      addEntry(runId, { ...rejected, methodId: null, property: null, reason: `requests to ${url.host} are not allowed` })
      return refuse(`Requests to ${url.host} are not allowed. Only the Search Console API is reachable.`)
    }

    const operation = matchOperation(request.method, url.pathname.slice(base.pathname.length))
    if (!operation) {
      addEntry(runId, { ...rejected, methodId: null, property: null, reason: 'not in the spec' })
      return refuse(`${request.method} ${url.pathname} is not a Search Console API method. Use search to find the right path.`)
    }

    const known = { methodId: operation.methodId, httpMethod: request.method, property: operation.property ?? null, write: operation.write }
    if (operation.write) {
      addEntry(runId, { ...known, status: 'rejected', reason: 'writes are not enabled yet' })
      return refuse(`${operation.methodId} changes data, and this server does not send writes yet.`)
    }

    const index = addEntry(runId, { ...known, status: 'dispatched' })
    const headers = new Headers(request.headers)
    headers.set('Authorization', `Bearer ${token}`)
    try {
      const response = await fetch(new Request(request, { headers }))
      updateEntry(runId, index, { status: response.ok ? 'succeeded' : 'failed', httpStatus: response.status })
      return response
    } catch (error) {
      updateEntry(runId, index, { status: 'failed', reason: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
}

/**
 * Render a run as `{ result, callRecord }` within the result cap (ADR-0005).
 * The call record is never cut, so the result gets whatever room it leaves.
 */
function formatRun(result: unknown, callRecord: CallRecordEntry[]): string {
  const pretty = JSON.stringify({ result, callRecord }, null, 2)
  if (pretty.length <= MAX_CHARS) return pretty
  const compact = JSON.stringify({ result, callRecord })
  if (compact.length <= MAX_CHARS) return compact
  // Room left once the call record and the wrapper are in place.
  const room = MAX_CHARS - JSON.stringify({ result: null, callRecord }).length + 'null'.length
  return JSON.stringify({ result: shrinkToFit(result, Math.max(2, room)), callRecord })
}

/** A refusal shaped like a Google API error, so gsc.request reports it the same way. */
function refuse(message: string): Response {
  return Response.json({ error: { code: 403, message } }, { status: 403 })
}

function prelude(apiBase: string): string {
  return `
const apiBase = ${JSON.stringify(apiBase)};
const gsc = {
  async request({ method = "GET", path, query, body }) {
    const url = new URL(String(path).replace(/^\\/+/, ""), apiBase);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const init = { method, headers: {} };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await fetch(url, init);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const message = data?.error?.message ?? text;
      throw new Error("Search Console API error " + response.status + ": " + message);
    }
    return data;
  }
};`
}

const DESCRIPTION = `Run JavaScript against the Google Search Console API. Use search first to find the method, its path and its notes.

Your code can call:

declare const gsc: {
  request(options: {
    method?: "GET" | "POST" | "PUT" | "DELETE"   // default "GET"
    path: string                                 // relative to the API base, e.g. "webmasters/v3/sites"
    query?: Record<string, string | number | boolean | undefined>
    body?: unknown                               // sent as JSON
  }): Promise<any>                               // parsed JSON; throws on an API error
}

Name the property in the path, URL-encoded. Find properties with sites.list. One website often has both a Domain property (sc-domain:example.com) and a URL-prefix property (https://example.com/), and they report different numbers, so always say which property you used.

Only Search Console API methods from the spec can be sent. Writes are not enabled yet. One run may send at most ${MAX_REQUESTS} requests and must finish within 30 seconds.

The response has two parts: "result" is what your code returned, and "callRecord" lists every request your code sent and what happened to it.

Your code must be an async arrow function that returns the result. Example:

async () => {
  const property = encodeURIComponent("sc-domain:example.com");
  return gsc.request({
    method: "POST",
    path: \`webmasters/v3/sites/\${property}/searchAnalytics/query\`,
    body: { startDate: "2026-09-01", endDate: "2026-09-07", dimensions: ["query"], rowLimit: 10 }
  });
}`

/** Register the execute tool (ADR-0001, ADR-0005, ADR-0006). */
export function registerExecuteTool(server: McpServer, env: Env): void {
  server.registerTool(
    'execute',
    {
      title: 'Search Console API execute',
      description: DESCRIPTION,
      inputSchema: z.object({
        code: z.string().describe('JavaScript async arrow function that calls gsc.request()')
      }),
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: true }
    },
    async ({ code }) => {
      const runId = crypto.randomUUID()
      openRun(runId)
      try {
        const result = await runInSandbox(env.LOADER, {
          code,
          prelude: prelude(env.GSC_API_BASE),
          globalOutbound: exports.GscOutbound({ props: { token: env.GSC_ACCESS_TOKEN, runId } }),
          limits: RUNTIME_LIMITS,
          timeoutMs: Number(env.EXECUTE_TIMEOUT_MS)
        })
        return { content: [{ type: 'text', text: formatRun(result, closeRun(runId)) }] }
      } catch (error) {
        const callRecord = closeRun(runId)
        const message = error instanceof Error ? error.message : String(error)
        return formatError(`${message}\n\nCall record:\n${JSON.stringify(callRecord, null, 2)}`)
      }
    }
  )
}
