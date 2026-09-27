import { z } from 'zod'
import { OAuthError } from './oauth-utils'
import type { AccessLevel } from './pages'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

export const READ_ONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
export const FULL_SCOPE = 'https://www.googleapis.com/auth/webmasters'

/** The Google scopes to ask for at each access level (ADR-0003). */
export function scopesFor(accessLevel: AccessLevel): string[] {
  return ['openid', 'email', accessLevel === 'full' ? FULL_SCOPE : READ_ONLY_SCOPE]
}

/**
 * The access level Google actually granted. Google's consent screen lets a
 * person untick a scope, so this reads the token response, not the request.
 */
export function accessLevelFromScope(scope: string | undefined): AccessLevel | undefined {
  const granted = (scope ?? '').split(' ')
  if (granted.includes(FULL_SCOPE)) return 'full'
  if (granted.includes(READ_ONLY_SCOPE)) return 'read-only'
  return undefined
}

export function authorizationUrl(params: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  accessLevel: AccessLevel
}): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scopesFor(params.accessLevel).join(' '))
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // Offline access returns a refresh token. prompt=consent makes Google send
  // one on every login, not only the first.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  return url.href
}

const TokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional()
})
export type TokenResponse = z.infer<typeof TokenResponse>

const GoogleError = z.object({ error: z.string(), error_description: z.string().optional() })

async function postToken(form: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    // Only Google's own error code decides whether a grant is dead. Cloudflare's
    // version treats every 400 as invalid_grant, which would revoke grants on
    // errors such as invalid_request.
    const parsed = GoogleError.safeParse(body)
    const code = parsed.success ? parsed.data.error : response.status >= 500 ? 'temporarily_unavailable' : 'server_error'
    const description = parsed.success ? (parsed.data.error_description ?? parsed.data.error) : `Google token endpoint returned ${response.status}`
    throw new OAuthError(code, description, response.status >= 500 ? 503 : 400)
  }
  return TokenResponse.parse(body)
}

export function exchangeCode(params: {
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
  codeVerifier: string
}): Promise<TokenResponse> {
  return postToken({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    code: params.code,
    code_verifier: params.codeVerifier
  })
}

export function refreshAccessToken(params: {
  clientId: string
  clientSecret: string
  refreshToken: string
}): Promise<TokenResponse> {
  return postToken({
    grant_type: 'refresh_token',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken
  })
}

const UserInfo = z.object({ sub: z.string(), email: z.string() })

export async function fetchUser(accessToken: string): Promise<{ id: string; email: string }> {
  const response = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new OAuthError('server_error', `Google userinfo returned ${response.status}`, 502)
  const { sub, email } = UserInfo.parse(await response.json())
  return { id: sub, email }
}
