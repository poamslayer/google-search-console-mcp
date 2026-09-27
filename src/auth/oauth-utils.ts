// Adapted from cloudflare/mcp src/auth/workers-oauth-utils.ts and src/auth/cloudflare-auth.ts
// (Apache-2.0). Modified by Arnold De La Vega: kept the CSRF, state, session-binding, PKCE
// and redirect-URI helpers; replaced the approval dialog and error page with short
// Search Console versions in ./pages.ts; dropped the legacy base64 state format.

import { z } from 'zod'

import { OAuthError as ProviderOAuthError, type AuthRequest } from '@cloudflare/workers-oauth-provider'
import { renderErrorPage, type AccessLevel } from './pages'

const CSRF_COOKIE = '__Host-CSRF_TOKEN'
const STATE_COOKIE = '__Host-CONSENTED_STATE'
const OAuthStateToken = z.uuid()

export function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value)
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}


export class OAuthError extends ProviderOAuthError {
  constructor(
    code: string,
    description: string,
    statusCode = 400,
    headers: Record<string, string> = {}
  ) {
    super(code, { description, statusCode, headers })
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({
        error: this.code,
        error_description: this.description
      }),
      {
        status: this.statusCode,
        headers: { 'Content-Type': 'application/json', ...this.headers }
      }
    )
  }

  toHtmlResponse(): Response {
    const titles: Record<string, string> = {
      invalid_request: 'Invalid Request',
      invalid_grant: 'Invalid Grant',
      invalid_client: 'Invalid Client',
      invalid_token: 'Invalid Token',
      unauthorized_client: 'Unauthorized Client',
      access_denied: 'Access Denied',
      unsupported_response_type: 'Unsupported Response Type',
      invalid_scope: 'Invalid Scope',
      insufficient_scope: 'Insufficient Scope',
      server_error: 'Server Error',
      temporarily_unavailable: 'Temporarily Unavailable'
    }
    const title = titles[this.code] || 'Authorization Error'
    const response = renderErrorPage(
      title,
      this.description,
      `Error code: ${this.code}`,
      this.statusCode
    )
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(this.headers ?? {})) headers.set(name, value)
    return new Response(response.body, { status: response.status, headers })
  }
}

/**
 * Scope template for preset selections
 */

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true

  const octets = normalized.split('.')
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  )
}

/**
 * MCP requires authorization redirects to use HTTPS, except for loopback
 * callbacks used by native clients. Reject URL features that make the
 * destination ambiguous or are forbidden for OAuth redirect endpoints.
 */
export function isAllowedOAuthRedirectUri(value: string): boolean {
  if (value !== value.trim()) return false

  try {
    const url = new URL(value)
    if (!url.hostname || url.username || url.password || url.hash) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && isLoopbackHostname(url.hostname)
  } catch {
    return false
  }
}


export interface ParsedApprovalResult {
  state: { oauthReqInfo?: AuthRequest }
  accessLevel: AccessLevel
}

/**
 * Parses the form submission from the approval dialog.
 */
export async function parseRedirectApproval(request: Request): Promise<ParsedApprovalResult> {
  if (request.method !== 'POST') {
    throw new OAuthError('invalid_request', 'Invalid request method', 405)
  }

  const formData = await request.formData()

  // Validate CSRF token
  const tokenFromForm = formData.get('csrf_token')
  if (!tokenFromForm || typeof tokenFromForm !== 'string') {
    throw new OAuthError('invalid_request', 'Missing CSRF token')
  }

  const cookieHeader = request.headers.get('Cookie') || ''
  const cookies = cookieHeader.split(';').map((c) => c.trim())
  const csrfCookie = cookies.find((c) => c.startsWith(`${CSRF_COOKIE}=`))
  const tokenFromCookie = csrfCookie ? csrfCookie.substring(CSRF_COOKIE.length + 1) : null

  if (!tokenFromCookie || tokenFromForm !== tokenFromCookie) {
    throw new OAuthError('access_denied', 'CSRF token mismatch', 403)
  }

  const encodedState = formData.get('state')
  if (!encodedState || typeof encodedState !== 'string') {
    throw new OAuthError('invalid_request', 'Missing state')
  }

  const state = JSON.parse(decodeBase64Utf8(encodedState))
  if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
    throw new OAuthError('invalid_request', 'Invalid state data')
  }

  const accessLevel = formData.get('access_level') ?? 'read-only'
  if (accessLevel !== 'read-only' && accessLevel !== 'full') {
    throw new OAuthError('invalid_request', 'Unknown access level')
  }

  return {
    state,
    accessLevel
  }
}

/**
 * Generate CSRF protection token and cookie
 */
export function generateCSRFProtection(): { token: string; setCookie: string } {
  const token = crypto.randomUUID()
  const setCookie = `${CSRF_COOKIE}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`
  return { token, setCookie }
}

/**
 * Create OAuth state in KV
 */
export async function createOAuthState(
  oauthReqInfo: AuthRequest,
  kv: KVNamespace,
  codeVerifier: string
): Promise<string> {
  const stateToken = crypto.randomUUID()
  await kv.put(`oauth:state:${stateToken}`, JSON.stringify({ oauthReqInfo, codeVerifier }), {
    expirationTtl: 600
  })
  return stateToken
}

/**
 * Bind state token to session via cookie
 */
export async function bindStateToSession(stateToken: string): Promise<{ setCookie: string }> {
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(stateToken))
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return {
    setCookie: `${STATE_COOKIE}=${hashHex}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`
  }
}

/**
 * Schema for validating stored OAuth state
 */

const StoredOAuthStateSchema = z.object({
  oauthReqInfo: z
    .object({
      clientId: z.string(),
      scope: z.array(z.string()).optional(),
      state: z.string().optional(),
      responseType: z.string().optional(),
      redirectUri: z.string().optional()
    })
    .passthrough(),
  codeVerifier: z.string().min(1)
})

/**
 * Check the state Google sent back: it must exist in KV and match the cookie
 * set on the browser that started the login. The state is single use.
 */
export async function validateOAuthState(
  request: Request,
  kv: KVNamespace
): Promise<{
  oauthReqInfo: AuthRequest
  codeVerifier: string
  clearCookie: string
}> {
  const url = new URL(request.url)
  const stateFromQuery = url.searchParams.get('state')

  if (!stateFromQuery) {
    throw new OAuthError('invalid_request', 'Missing state parameter')
  }

  const stateToken = OAuthStateToken.safeParse(stateFromQuery).success ? stateFromQuery : undefined
  if (!stateToken) {
    throw new OAuthError('invalid_request', 'Invalid state parameter')
  }

  // Validate state exists in KV
  const storedDataJson = await kv.get(`oauth:state:${stateToken}`)
  if (!storedDataJson) {
    throw new OAuthError('invalid_request', 'Invalid or expired state')
  }

  // Validate session binding cookie
  const cookieHeader = request.headers.get('Cookie') || ''
  const cookies = cookieHeader.split(';').map((c) => c.trim())
  const stateCookie = cookies.find((c) => c.startsWith(`${STATE_COOKIE}=`))
  const stateHash = stateCookie ? stateCookie.substring(STATE_COOKIE.length + 1) : null

  if (!stateHash) {
    throw new OAuthError('invalid_request', 'Missing session binding - restart authorization')
  }

  // Verify hash matches
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(stateToken))
  const expectedHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  if (stateHash !== expectedHash) {
    throw new OAuthError('invalid_request', 'State mismatch - possible CSRF attack')
  }

  // Parse and validate stored data
  const parseResult = StoredOAuthStateSchema.safeParse(JSON.parse(storedDataJson))
  if (!parseResult.success) {
    throw new OAuthError('server_error', 'Invalid stored state data')
  }

  // Delete state (single use)
  await kv.delete(`oauth:state:${stateToken}`)

  return {
    oauthReqInfo: parseResult.data.oauthReqInfo as AuthRequest,
    codeVerifier: parseResult.data.codeVerifier,
    clearCookie: `${STATE_COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`
  }
}

const PKCE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
const CODE_VERIFIER_LENGTH = 96

function base64urlEncode(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export interface PKCECodes {
  codeChallenge: string
  codeVerifier: string
}

/**
 * Generate PKCE codes for OAuth authorization (S256 method)
 */
export async function generatePKCECodes(): Promise<PKCECodes> {
  const output = new Uint32Array(CODE_VERIFIER_LENGTH)
  crypto.getRandomValues(output)

  const codeVerifier = base64urlEncode(
    Array.from(output)
      .map((num) => PKCE_CHARSET[num % PKCE_CHARSET.length])
      .join('')
  )

  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  const hash = new Uint8Array(buffer)

  let binary = ''
  for (let i = 0; i < hash.byteLength; i++) {
    binary += String.fromCharCode(hash[i])
  }

  return { codeChallenge: base64urlEncode(binary), codeVerifier }
}

/**
 * Build the Cloudflare OAuth authorization URL
 */
