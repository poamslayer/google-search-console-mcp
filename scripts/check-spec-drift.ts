import { readFileSync } from 'node:fs'

// Reports whether Google has published a newer Discovery document than the
// vendored one (ADR-0004). A person decides whether to take the new revision.
const DISCOVERY = 'vendor/discovery/searchconsole-v1-20260923.json'
const LIVE_URL = 'https://searchconsole.googleapis.com/$discovery/rest?version=v1'

const vendored = JSON.parse(readFileSync(DISCOVERY, 'utf8')).revision as string
const live = ((await (await fetch(LIVE_URL)).json()) as { revision: string }).revision

if (live === vendored) {
  console.log(`No drift: the vendored revision ${vendored} is current.`)
} else {
  console.log(`Drift: Google publishes revision ${live}, and this repo vendors ${vendored}.`)
  process.exitCode = 1
}
