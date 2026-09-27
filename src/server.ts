import { McpServer } from '@modelcontextprotocol/server'
import type { AuthProps } from './auth/props'
import { registerExecuteTool } from './tools/execute'
import { registerSearchTool } from './tools/search'

export const SERVER_INFO = { name: 'google-search-console', version: '0.1.0' }

/** Build the MCP server for one request from one logged-in user. */
export function createServer(env: Env, props: AuthProps): McpServer {
  const server = new McpServer(SERVER_INFO)
  registerSearchTool(server, env.LOADER)
  registerExecuteTool(server, env, props)
  return server
}
