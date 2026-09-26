# The agent's code names the property

`execute` has no `siteUrl` argument. The agent's code finds properties with `sites.list` and puts the property in each request path. So every entry in the call record shows which property it touched.

Cloudflare's `execute` takes an `account_id` argument and fills it in when the user can see only one account. That works for Cloudflare because most people have one account. It works poorly for Search Console, because one website usually has two properties, a Domain property (`sc-domain:example.com`) and a URL-prefix property (`https://example.com/`), and they report different numbers. The "only one property" case would rarely happen. An argument would also give two places to name the target, the argument and the path, and they could disagree.

The `execute` tool description tells the agent to say which property it used whenever a website has both kinds.
