# Google decides what a user can change

Every Search Console operation is in the spec, including `sites.delete` and `sitemaps.delete`. This server does not decide which operations are allowed. The user decides at login by choosing an access level, and Google enforces it through the OAuth scope. Read-only (`webmasters.readonly`) is the default. Full access (`webmasters`) is an opt-in. Cloudflare's server works the same way, with a read-only template as its default.

## Considered options

- **Leave the deletes out of the spec.** This is safer, but it means the server cannot do everything the user's own Google access allows. We chose to rely on the access level and on the call record (ADR-0005) instead.
- **Read-only only.** This rules out submitting sitemaps, which is the write users most often want from an agent.

## Login

We copy Cloudflare's login design. `@cloudflare/workers-oauth-provider` sits in front of the server, and Google is the login behind it. The user's Google tokens are stored in the grant in KV and are never passed into the sandbox. When the client refreshes its token, the server also refreshes the Google token. If Google rejects the refresh, the server revokes the grant so the client asks the user to log in again.

## The Google app

- A new Google Cloud project owns the OAuth app and its quota. It is separate from the OAuth client that Arnold's current local Search Console server uses.
- The app launches "In production" but unverified. Users see an unverified app warning, and Google allows at most 100 users in total. We chose this over "Testing" status because Google expires Testing refresh tokens after 7 days.
- Before the URL is shared publicly, the app goes through Google's verification. Google needs a home page and a privacy policy on the verified domain, so the Worker serves both itself at `/` and `/privacy`.
