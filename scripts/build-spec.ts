import { readFileSync, writeFileSync } from 'node:fs'
import { buildSpec } from '../src/spec/build'
import { NOTES } from '../src/spec/notes'

const DISCOVERY = 'vendor/discovery/searchconsole-v1-20260923.json'
const OUTPUT = 'src/spec/spec.generated.json'

const spec = buildSpec(JSON.parse(readFileSync(DISCOVERY, 'utf8')), NOTES)
writeFileSync(OUTPUT, JSON.stringify(spec, null, 2) + '\n')
console.log(`Wrote ${OUTPUT}: revision ${spec.revision}, ${Object.keys(spec.methods).length} methods`)
