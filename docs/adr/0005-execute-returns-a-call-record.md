# Execute returns a call record

`execute` returns the value the agent's code returned and, beside it, a call record. The call record lists every request the run sent, with the method, the property, whether it was a write, and what happened to it. The server keeps the call record, so agent code cannot read, change or hide it.

Cloudflare's `execute` returns only the code's result, or only an error. We depart from it for the same reason `~/intelligrc-mcp` did in its ADR-0005. To an MCP client, one `execute` call that reads a report looks the same as one that also submits a sitemap. The call record shows the difference, including when the code catches its own error and reports success.

## Result size

We cap each result at about 6,000 tokens, as Cloudflare does. When a result is too large, it stays valid JSON. Long lists keep their first items and the cuts are marked. Without the cap, a 25,000 row report would land in the agent's context in full.

## Execution limits

Each `execute` run has limits. The starting values are:

- about 30 seconds of wall time,
- 50 API requests,
- 5 writes.

The main reason is Google's URL inspection quota of 2,000 inspections per property per day. Without a request limit, one loop could use it all. Each user also has a daily cap of about 500 runs (ADR-0002). These values are starting points, and we expect to tune them.
