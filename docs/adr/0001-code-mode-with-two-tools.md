# Code Mode with two tools

This server follows Cloudflare's Code Mode pattern (github.com/cloudflare/mcp). The agent gets a `search` tool that runs code against the spec and an `execute` tool that runs code against the Search Console API. It does not get one tool per API operation.

## The token argument is weak here

Cloudflare chose Code Mode because its API has about 2,500 endpoints, and even minimal tool schemas for them cost about 244,000 tokens. The Search Console API has about 10 operations. Ten native tools would fit in context easily, so saving tokens is not the reason for this decision.

## The reason is composition

Most Search Console questions take several calls whose results have to be combined:

- A full report needs paging, because one analytics request returns at most 25,000 rows.
- Comparing two periods means running two reports and joining them by query or page.
- Checking the index status of many URLs means running hundreds of inspections within Google's per-minute and per-day limits.

With one tool per operation, every intermediate result passes through the agent's context before it becomes the next call's input. With Code Mode, the agent's code does the combining in the sandbox and returns only the answer. The current server this project replaces has 21 fixed tools, and most of them exist to do one of these combinations.

## No `docs` tool

Cloudflare has a third tool, `docs`, that searches its own documentation through an index it already runs. Google publishes no search API for its Search Console documentation, so a `docs` tool would mean crawling and hosting that documentation ourselves. The behaviour the agent needs to know is short and stable, so we attach it to the spec as notes instead (ADR-0004).

## No native mode in v1

Cloudflare also offers `?codemode=false`, which registers one tool per endpoint for clients that already do Code Mode themselves. We leave it out of v1 because it is a second surface to test and nobody has asked for it.
