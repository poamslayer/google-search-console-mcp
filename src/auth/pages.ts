import type { AuthRequest, ClientInfo } from '@cloudflare/workers-oauth-provider'
import { encodeBase64Utf8 } from './oauth-utils'

/** The two access levels a user can grant (ADR-0003). */
export type AccessLevel = 'read-only' | 'full'

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const STYLE = `
  :root { color-scheme: light dark; --bg: #f6f7f9; --panel: #fff; --ink: #1b2330; --muted: #5a6676; --line: #d6dde6; --accent: #1f6f8b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #11161d; --panel: #18202a; --ink: #e4e9ef; --muted: #9aa6b4; --line: #2c3643; --accent: #5db4d2; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 16px; background: var(--bg); color: var(--ink); font: 16px/1.55 system-ui, sans-serif; }
  main { max-width: 520px; margin: 0 auto; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 28px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { margin: 0 0 16px; color: var(--muted); }
  label.choice { display: grid; grid-template-columns: 20px 1fr; gap: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin-bottom: 12px; cursor: pointer; }
  label.choice strong { display: block; color: var(--ink); }
  label.choice span { color: var(--muted); font-size: 15px; }
  button { width: 100%; padding: 12px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font-size: 16px; cursor: pointer; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  code { font-size: 14px; }
`

function page(title: string, body: string, status: number, headers: Record<string, string> = {}): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', ...headers }
  })
}

export interface ApprovalDialogOptions {
  client: ClientInfo | null
  oauthReqInfo: AuthRequest
  csrfToken: string
  setCookie: string
}

/** The consent page: the user picks read-only or full access, then goes to Google. */
export function renderApprovalDialog({ client, oauthReqInfo, csrfToken, setCookie }: ApprovalDialogOptions): Response {
  const clientName = escapeHtml(client?.clientName || oauthReqInfo.clientId)
  const state = encodeBase64Utf8(JSON.stringify({ oauthReqInfo }))
  return page(
    'Search Console MCP: allow access',
    `<h1>Allow ${clientName} to use Search Console?</h1>
    <p>${clientName} will run code against the Google Search Console API as you. Choose what it may do. Google will ask you to confirm next.</p>
    <form method="post" action="/authorize">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
      <label class="choice"><input type="radio" name="access_level" value="read-only" checked>
        <div><strong>Read-only</strong><span>See reports, inspect URLs, and list properties and sitemaps. Nothing can be changed.</span></div></label>
      <label class="choice"><input type="radio" name="access_level" value="full">
        <div><strong>Full access</strong><span>Everything in read-only, plus submit and delete sitemaps, and add and remove properties.</span></div></label>
      <button type="submit">Continue to Google</button>
    </form>`,
    200,
    { 'Set-Cookie': setCookie }
  )
}

/** A plain error page. */
export function renderErrorPage(title: string, message: string, details?: string, status = 400): Response {
  return page(
    title,
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${details ? `<p><code>${escapeHtml(details)}</code></p>` : ''}`,
    status
  )
}
