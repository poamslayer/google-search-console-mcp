# Search Console MCP

The vocabulary for a Model Context Protocol server that gives an AI agent access to Google Search Console. The agent writes code against the Search Console API instead of calling one tool per operation.

## Language

### How the agent works

**Code Mode**:
The pattern this server uses. The agent gets a small, fixed set of tools that accept code, and it writes code against the API instead of calling one tool per operation.
_Avoid_: programmatic tool calling, codegen

**Tool**:
One MCP tool the server exposes to the agent. There are two. `search` reads the spec, and `execute` calls the API.
_Avoid_: function, endpoint, command

**Spec**:
This project's copy of Google's description of the Search Console API, with notes attached. The agent's `search` code reads it.
_Avoid_: schema, catalog, discovery doc (when the processed copy is meant)

**Note**:
A short statement about how Search Console behaves that the spec does not say, attached to the method it applies to. A person reviews every note before it ships.
_Avoid_: doc, hint, tip

**Sandbox**:
The isolated place where agent code runs. It holds no credential and can reach only the Search Console API, and only through the server.
_Avoid_: VM, container, runtime

**Call record**:
The list of every request one `execute` run sent and what happened to each one. The server keeps it, and agent code cannot read or change it.
_Avoid_: ledger, log, audit trail

### Search Console

**Property**:
One thing a person has verified in Search Console, named by its site URL. Every report and inspection belongs to exactly one property.
_Avoid_: site, account, domain

**Domain property**:
A property that covers a whole domain, including every subdomain and both http and https. Its site URL starts with `sc-domain:`.

**URL-prefix property**:
A property that covers only URLs that start with one exact prefix, e.g., `https://example.com/`. The same website often has both a Domain property and a URL-prefix property, and they report different numbers.

### Access and limits

**User**:
A person who has logged in to the server with their own Google account. The server acts only with that person's Search Console access.
_Avoid_: tenant, customer, account

**Access level**:
What a user allowed at login. It is either read-only or full access. Google enforces it, not this server.
_Avoid_: permission, role, mode

**Execution limits**:
The ceilings on one `execute` run, e.g., how many requests it may send.
_Avoid_: quota (Google's own limits are the quota)

**Daily cap**:
The ceiling on how many `execute` runs one user may make in a day.
_Avoid_: rate limit, quota

**Quota**:
Google's own limits on Search Console API use. Some apply per property or per user, and some apply to the whole server, so every user shares them.
