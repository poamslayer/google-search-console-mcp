import { SITE_URL_NOTE, type Notes } from './notes'

/** One Search Console API method as the agent's search code sees it. */
export interface SpecMethod {
  httpMethod: string
  /** Relative to the API base, e.g. `webmasters/v3/sites/{siteUrl}`. */
  path: string
  description: string
  parameters: Record<string, unknown>
  request?: unknown
  response?: unknown
  scopes: string[]
  write: boolean
  notes: string[]
}

export interface Spec {
  revision: string
  methods: Record<string, SpecMethod>
}

/** The only operations that change anything. Two reads use POST, so the HTTP method cannot decide this. */
const WRITES = new Set(['sites.add', 'sites.delete', 'sitemaps.submit', 'sitemaps.delete'])

/** Retired by Google on 1 December 2023 but still listed in the Discovery document (ADR-0004). */
const RETIRED = new Set(['urlTestingTools.mobileFriendlyTest.run'])

interface DiscoveryMethod {
  id: string
  httpMethod: string
  path: string
  flatPath?: string
  description?: string
  parameters?: Record<string, unknown>
  request?: { $ref: string }
  response?: { $ref: string }
  scopes?: string[]
}

interface DiscoveryResource {
  methods?: Record<string, DiscoveryMethod>
  resources?: Record<string, DiscoveryResource>
}

interface DiscoveryDocument extends DiscoveryResource {
  revision: string
  schemas: Record<string, unknown>
}

/** Build the spec from Google's Discovery document and our notes. */
export function buildSpec(discovery: unknown, notes: Notes): Spec {
  const doc = discovery as DiscoveryDocument
  const methods: Record<string, SpecMethod> = {}

  for (const method of collectMethods(doc)) {
    // Drop the service prefix: `webmasters.sites.list` becomes `sites.list`.
    const id = method.id.split('.').slice(1).join('.')
    if (RETIRED.has(id)) continue

    const path = method.flatPath ?? method.path
    methods[id] = {
      httpMethod: method.httpMethod,
      path,
      description: method.description ?? '',
      parameters: method.parameters ?? {},
      ...(method.request && { request: resolve(method.request, doc.schemas) }),
      ...(method.response && { response: resolve(method.response, doc.schemas) }),
      scopes: method.scopes ?? [],
      write: WRITES.has(id),
      notes: [...(notes[id] ?? []), ...(path.includes('{siteUrl}') ? [SITE_URL_NOTE] : [])]
    }
  }

  const sorted = Object.fromEntries(Object.entries(methods).sort(([a], [b]) => a.localeCompare(b)))
  return { revision: doc.revision, methods: sorted }
}

function collectMethods(resource: DiscoveryResource): DiscoveryMethod[] {
  const own = Object.values(resource.methods ?? {})
  const nested = Object.values(resource.resources ?? {}).flatMap(collectMethods)
  return [...own, ...nested]
}

/** Replace every `$ref` with the schema it names. A schema already being expanded stays a name, so cycles end. */
function resolve(node: unknown, schemas: Record<string, unknown>, expanding: string[] = []): unknown {
  if (Array.isArray(node)) return node.map((item) => resolve(item, schemas, expanding))
  if (node === null || typeof node !== 'object') return node

  const ref = (node as { $ref?: unknown }).$ref
  if (typeof ref === 'string') {
    if (expanding.includes(ref)) return { type: 'object', description: `Recursive reference to ${ref}` }
    return resolve(schemas[ref], schemas, [...expanding, ref])
  }

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, resolve(value, schemas, expanding)])
  )
}
