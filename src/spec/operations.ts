import spec from './spec.generated.json'

/** A request matched to one spec method. */
export interface Operation {
  methodId: string
  write: boolean
  /** The decoded {siteUrl} from the path, when the path has one. */
  property: string | undefined
}

interface Template {
  methodId: string
  httpMethod: string
  write: boolean
  segments: string[]
}

const TEMPLATES: Template[] = Object.entries(spec.methods).map(([methodId, method]) => ({
  methodId,
  httpMethod: method.httpMethod,
  write: method.write,
  segments: method.path.split('/')
}))

/**
 * Match an HTTP method and a path relative to the API base to a spec method.
 * Returns undefined for anything the spec does not list, so the caller can
 * refuse to send it. A {placeholder} matches exactly one path segment, so a
 * property must be URL-encoded to match.
 */
export function matchOperation(httpMethod: string, path: string): Operation | undefined {
  const segments = path.replace(/^\/+/, '').split('/').map(decodeSegment)
  if (segments.includes(undefined)) return undefined

  for (const template of TEMPLATES) {
    if (template.httpMethod !== httpMethod.toUpperCase()) continue
    if (template.segments.length !== segments.length) continue

    let property: string | undefined
    const matches = template.segments.every((part, i) => {
      const actual = segments[i] as string
      if (part.startsWith('{') && part.endsWith('}')) {
        if (part === '{siteUrl}') property = actual
        return actual.length > 0
      }
      return part === actual
    })

    if (matches) return { methodId: template.methodId, write: template.write, property }
  }
  return undefined
}

function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}
