// Adapted from cloudflare/mcp src/utils/errors.ts (Apache-2.0). Modified by Arnold De La Vega.

/** The MCP error result every tool returns when it fails. */
export function formatError(error: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}
