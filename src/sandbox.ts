// The sandbox pattern is adapted from cloudflare/mcp src/tools/search.ts and
// src/tools/execute.ts (Apache-2.0). Modified by Arnold De La Vega.

/** The compatibility date every sandbox runs with. */
const COMPATIBILITY_DATE = '2026-01-12'

export interface SandboxRun {
  /** The agent's code: an async arrow function, as source text. */
  code: string
  /** Module-level source that runs before the agent's code, e.g. `const spec = {...}`. */
  prelude: string
  /** Where the sandbox's fetch() goes. `null` means no network at all. */
  globalOutbound: Fetcher | null
  /** CPU and request limits the runtime enforces inside the sandbox. */
  limits?: { cpuMs?: number; subRequests?: number }
  /** Wall time after which the host stops waiting. */
  timeoutMs?: number
}

type Outcome = { result: unknown; err?: undefined } | { result?: undefined; err: string }

/**
 * Run the agent's code in a fresh Dynamic Worker and return what it returned.
 * The code is written into the module source because Dynamic Workers do not
 * allow eval. Throws with the code's own message if the code throws.
 */
export async function runInSandbox(loader: WorkerLoader, run: SandboxRun): Promise<unknown> {
  const worker = loader.load({
    compatibilityDate: COMPATIBILITY_DATE,
    globalOutbound: run.globalOutbound,
    ...(run.limits && { limits: run.limits }),
    mainModule: 'sandbox.js',
    modules: {
      'sandbox.js': `
import { WorkerEntrypoint } from "cloudflare:workers";
${run.prelude}
export default class Sandbox extends WorkerEntrypoint {
  async evaluate() {
    try {
      return { result: await (${run.code})() };
    } catch (err) {
      return { err: err instanceof Error ? err.message : String(err) };
    }
  }
}
`
    }
  })

  const entrypoint = worker.getEntrypoint() as unknown as { evaluate(): Promise<Outcome> }
  const outcome = await withTimeout(entrypoint.evaluate(), run.timeoutMs)
  if (outcome.err !== undefined) throw new Error(outcome.err)
  return outcome.result
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) return work
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Execution timed out after ${timeoutMs / 1000} seconds`)),
      timeoutMs
    )
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}
