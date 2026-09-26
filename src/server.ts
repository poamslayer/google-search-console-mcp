import { McpServer } from '@modelcontextprotocol/server'

export const SERVER_INFO = { name: 'google-search-console', version: '0.1.0' }

/** Build the MCP server for one request. */
export function createServer(): McpServer {
  return new McpServer(SERVER_INFO)
}
