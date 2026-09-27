# Search Console MCP

A remote MCP server for the Google Search Console API. It runs on Cloudflare Workers and follows Cloudflare's Code Mode pattern ([cloudflare/mcp](https://github.com/cloudflare/mcp)). The agent gets two tools that accept code, instead of one tool per API method.

- `search` runs the agent's JavaScript against the Search Console API spec, with notes about how the API behaves. The code has no network access.
- `execute` runs the agent's JavaScript with `gsc.request()`, which calls the Search Console API as the logged-in user. It returns the code's result and a call record of every request the code sent.

Users log in with Google and choose read-only or full access. Full access is needed to submit or delete sitemaps and to add or remove properties.

The design decisions are in [docs/adr](docs/adr), and the vocabulary is in [CONTEXT.md](CONTEXT.md).

## Run it locally

You need Node 24 (`nvm use` reads `.nvmrc`) and a Google OAuth client. The client must have `http://localhost:2530/oauth/callback` as a redirect URI.

1. Install the dependencies with `npm install`.
2. Copy `.dev.vars.example` to `.dev.vars` and fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The file is gitignored.
3. Start the server with `npm run dev`. It listens on `http://localhost:2530`.
4. Add `http://localhost:2530/mcp` to your MCP client as an HTTP server. The client opens a browser for the Google login.

## Deploy

The server runs at `https://google-search-console-mcp.arnolddlv-1e4.workers.dev/mcp`. It needs the Workers Paid plan, because the sandbox uses the Dynamic Worker Loader.

1. The Google OAuth client must be a **Web application** client, not a Desktop app client. It needs the redirect URI `https://google-search-console-mcp.arnolddlv-1e4.workers.dev/oauth/callback`.
2. Upload the client with `wrangler secret put GOOGLE_CLIENT_ID` and `wrangler secret put GOOGLE_CLIENT_SECRET`.
3. Deploy with `npm run deploy`.

When you log in, Google shows a checkbox for Search Console. You must tick it, or the server refuses the login.

## Tests

`npm run check` runs the typecheck and the tests. The tests run in Cloudflare's local runtime with the real Worker Loader, and MSW fakes Google.

Two limits are not enforced by the local runtime, so the tests cannot check them. They only take effect on Cloudflare:

- the sandbox CPU limit,
- the runtime's own request limit. The server enforces its own cap of 50 requests per run, and the tests cover that cap.

## Licence

Apache-2.0. Parts are adapted from cloudflare/mcp; see [NOTICE](NOTICE).
