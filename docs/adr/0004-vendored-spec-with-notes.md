# A vendored spec with notes attached

We commit a copy of Google's Discovery document for `searchconsole v1`, at revision 20260923, and build the spec from it. A drift check reports when Google publishes a newer revision, and a person decides whether to take it.

Cloudflare does this differently. A daily cron job fetches their OpenAPI document and stores it in R2. We chose a vendored copy because Google changes this API rarely, and because a pinned copy means the tests cover exactly the spec that runs. With a daily fetch, the running spec can change without a deploy or a test run.

## Notes

The Discovery document says what each method takes. It does not say how Search Console behaves. For example, it does not say that grouping a report by query drops anonymised queries, so the rows add up to less than the total. We write short notes like that one, a person reviews each one, and we attach each note to the method it applies to. When the agent's `search` code looks up a method, the notes for that method come back with it. This is how we cover what Cloudflare's `docs` tool covers (ADR-0001).

## Removed method

We leave `urlTestingTools.mobileFriendlyTest.run` out of the spec. Google retired the Mobile-Friendly Test API on 1 December 2023, but the Discovery document still lists it.
