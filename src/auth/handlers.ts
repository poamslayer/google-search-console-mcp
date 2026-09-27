// Adapted from cloudflare/mcp src/auth/oauth-handler.ts (Apache-2.0). Modified by
// Arnold De La Vega: Google is the upstream login, the consent page offers two
// access levels, the access level comes from the scope Google granted, the
// refresh keeps the old Google refresh token, and metrics are dropped.
import { env as workerEnv } from 'cloudflare:workers'
import { Hono } from 'hono'
import {
  AuthorizationError,
  CimdFetchError,
  type AuthRequest,
  type OAuthHelpers,
  type TokenExchangeCallbackOptions,
  type TokenExchangeCallbackResult
} from '@cloudflare/workers-oauth-provider'
import { accessLevelFromScope, authorizationUrl, exchangeCode, fetchUser, refreshAccessToken } from './google'
import {
  OAuthError,
  bindStateToSession,
  createOAuthState,
  generateCSRFProtection,
  generatePKCECodes,
  isAllowedOAuthRedirectUri,
  parseRedirectApproval,
  validateOAuthState
} from './oauth-utils'
import { renderApprovalDialog, renderErrorPage } from './pages'
import { AUTH_PROPS_VERSION, AuthProps } from './props'
import { withRefreshAdmission } from './refresh-admission-gate'

interface AuthEnv extends Env {
  OAUTH_PROVIDER: OAuthHelpers
}
const env = workerEnv as AuthEnv

const CALLBACK_PATH = '/oauth/callback'

/**
 * Refresh the user's Google token whenever workers-oauth-provider refreshes
 * the client's token. Google usually does not send a new refresh token, so the
 * old one is kept. Only Google's invalid_grant revokes the grant.
 */
export async function handleTokenExchangeCallback(
  options: TokenExchangeCallbackOptions,
  clientId: string,
  clientSecret: string,
  getHelpers?: () => OAuthHelpers
): Promise<TokenExchangeCallbackResult | undefined> {
  if (options.grantType !== 'refresh_token') return undefined

  const props = AuthProps.parse(options.props)
  if (!props.refreshToken) return undefined
  if (!options.userId || !options.grantId) {
    throw new Error('Refresh token exchange is missing its grant identity')
  }
  const grant = { userId: options.userId, grantId: options.grantId }
  const googleRefreshToken = props.refreshToken

  try {
    return await withRefreshAdmission(env.OAUTH_KV, grant, async () => {
      const refreshed = await refreshAccessToken({ clientId, clientSecret, refreshToken: googleRefreshToken })
      return {
        newProps: {
          ...props,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? googleRefreshToken
        } satisfies AuthProps,
        accessTokenTTL: refreshed.expires_in
      }
    })
  } catch (error) {
    // A Google invalid_grant is permanent (revoked, expired or password
    // changed). Revoke only this grant so the client asks the user to log in again.
    if (error instanceof OAuthError && error.code === 'invalid_grant' && getHelpers) {
      try {
        await getHelpers().revokeGrant(grant.grantId, grant.userId)
      } catch (revokeError) {
        console.error('Failed to revoke grant after Google invalid_grant', revokeError)
      }
    }
    throw error
  }
}

function serverError(error: unknown, message: string): Response {
  if (error instanceof OAuthError) return error.toHtmlResponse()
  const errorId = crypto.randomUUID()
  console.error(`Auth error [${errorId}]:`, error)
  return renderErrorPage('Server error', message, `Error ID: ${errorId}`, 500)
}

function invalidRedirectUriResponse(): Response {
  return new OAuthError('invalid_request', 'The client redirect URI must use HTTPS or a loopback address.').toHtmlResponse()
}

/** The login routes: the consent page, the redirect to Google, and Google's callback. */
export function createAuthHandlers() {
  const app = new Hono()

  // GET /authorize: show the consent page.
  app.get('/authorize', async (c) => {
    try {
      let oauthReqInfo: AuthRequest
      try {
        oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw)
      } catch (error) {
        if (error instanceof AuthorizationError) {
          if (!error.redirectUri || !isAllowedOAuthRedirectUri(error.redirectUri)) {
            return new OAuthError(error.code, error.description).toHtmlResponse()
          }
          const redirect = new URL(error.redirectUri)
          redirect.searchParams.set('error', error.code)
          redirect.searchParams.set('error_description', error.description)
          if (error.state) redirect.searchParams.set('state', error.state)
          if (error.issuer) redirect.searchParams.set('iss', error.issuer)
          return new Response(null, { status: 302, headers: { Location: redirect.href, 'Cache-Control': 'no-store' } })
        }
        throw error
      }
      if (!isAllowedOAuthRedirectUri(oauthReqInfo.redirectUri)) return invalidRedirectUriResponse()

      const { token: csrfToken, setCookie } = generateCSRFProtection()
      return renderApprovalDialog({
        client: await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId),
        oauthReqInfo,
        csrfToken,
        setCookie
      })
    } catch (error) {
      if (error instanceof CimdFetchError) {
        return renderErrorPage('Client unavailable', 'The client metadata document could not be fetched. Try again.', undefined, 503)
      }
      return serverError(error, 'An unexpected error occurred. Please try again.')
    }
  })

  // POST /authorize: the user chose an access level; send them to Google.
  app.post('/authorize', async (c) => {
    try {
      const { state, accessLevel } = await parseRedirectApproval(c.req.raw)
      if (!state.oauthReqInfo) return new OAuthError('invalid_request', 'Missing OAuth request info').toHtmlResponse()

      const oauthReqInfo = state.oauthReqInfo as AuthRequest
      if (!isAllowedOAuthRedirectUri(oauthReqInfo.redirectUri)) return invalidRedirectUriResponse()
      oauthReqInfo.scope = [accessLevel]

      const { codeChallenge, codeVerifier } = await generatePKCECodes()
      const stateToken = await createOAuthState(oauthReqInfo, env.OAUTH_KV, codeVerifier)
      const { setCookie } = await bindStateToSession(stateToken)

      const location = authorizationUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: new URL(CALLBACK_PATH, c.req.url).href,
        state: stateToken,
        codeChallenge,
        accessLevel
      })
      return new Response(null, { status: 302, headers: { Location: location, 'Set-Cookie': setCookie } })
    } catch (error) {
      return serverError(error, 'An unexpected error occurred. Please try again.')
    }
  })

  // GET /oauth/callback: Google sends the user back with a code.
  app.get(CALLBACK_PATH, async (c) => {
    try {
      const googleError = c.req.query('error')
      if (googleError) {
        return renderErrorPage('Login cancelled', 'Google did not grant access, so nothing was connected.', `Google said: ${googleError}`)
      }
      const code = c.req.query('code')
      if (!code) return new OAuthError('invalid_request', 'Missing code').toHtmlResponse()

      const { oauthReqInfo, codeVerifier, clearCookie } = await validateOAuthState(c.req.raw, env.OAUTH_KV)
      if (!isAllowedOAuthRedirectUri(oauthReqInfo.redirectUri)) {
        const response = invalidRedirectUriResponse()
        response.headers.append('Set-Cookie', clearCookie)
        return response
      }

      const tokens = await exchangeCode({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: new URL(CALLBACK_PATH, c.req.url).href,
        code,
        codeVerifier
      })
      const accessLevel = accessLevelFromScope(tokens.scope)
      if (!accessLevel) {
        return renderErrorPage(
          'Search Console access not granted',
          'Google did not grant access to Search Console. Log in again, and on Google\'s screen tick the box for Search Console before you click Continue.'
        )
      }
      const user = await fetchUser(tokens.access_token)

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        userId: user.id,
        metadata: { label: user.email },
        scope: [accessLevel],
        props: {
          version: AUTH_PROPS_VERSION,
          user,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          accessLevel
        } satisfies AuthProps
      })
      if (!isAllowedOAuthRedirectUri(redirectTo)) {
        throw new OAuthError('server_error', 'Authorization produced an unsafe redirect URI')
      }
      return new Response(null, { status: 302, headers: { Location: redirectTo, 'Set-Cookie': clearCookie } })
    } catch (error) {
      return serverError(error, 'An unexpected error occurred during login.')
    }
  })

  return app
}
