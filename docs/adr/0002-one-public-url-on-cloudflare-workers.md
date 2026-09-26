# One public URL on Cloudflare Workers

The server runs as one Cloudflare Worker at `https://gsc.poamslayer.com/mcp`, and anyone can connect to it. It is Arnold's personal open-source project. It does not belong to Vivid Technical Consulting or to the IT Consulting side venture.

Agent code runs in a Dynamic Worker Loader sandbox, as it does in cloudflare/mcp. The search sandbox has no network. The execute sandbox can reach only the Search Console API, through the server, which adds the user's token to each request.

## Considered options

- **Local stdio with isolated-vm.** This is how `~/intelligrc-mcp` works, and much of its sandbox code could have been reused. We rejected it because a local server works only in clients that can start a process, and not in claude.ai or on a phone.
- **A repo that each person deploys to their own Cloudflare account.** This avoids holding other people's Google tokens. We rejected it because each person would also need their own Google OAuth client, which is too much setup for most Search Console users.

## Consequences

- The Dynamic Worker Loader is in open beta and needs the Workers Paid plan. If Cloudflare changes it, the sandbox has to change too.
- Every user shares the Google Cloud project's quota and Arnold's Workers bill. So each user has a daily cap on `execute` runs, counted in KV, on top of the execution limits in ADR-0005.
- The `poamslayer.com` zone has a redirect rule that sends every request to arnolddelavega.com. Cloudflare runs redirect rules before Workers, so the rule must match only `poamslayer.com` and `www.poamslayer.com`. If anyone widens it again, the MCP URL and the Google login both break. Nothing in this repo shows that rule.
