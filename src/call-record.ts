/**
 * The call record (ADR-0005): every request one execute run sent, and what
 * happened to it. The host keeps it, keyed by run id, so the agent's code
 * cannot read, change or hide it.
 */
export type CallStatus = 'rejected' | 'dispatched' | 'succeeded' | 'failed' | 'indeterminate'

export interface CallRecordEntry {
  methodId: string | null
  httpMethod: string
  property: string | null
  write: boolean
  status: CallStatus
  httpStatus?: number
  reason?: string
}

// The outbound entrypoint and the tool handler run in the same isolate, so a
// module-level map is a store both can reach. tests/execute.test.ts checks this.
const runs = new Map<string, CallRecordEntry[]>()

export function openRun(runId: string): void {
  runs.set(runId, [])
}

/** Add an entry and return its index, for a later update. */
export function addEntry(runId: string, entry: CallRecordEntry): number {
  const entries = runs.get(runId)
  if (!entries) throw new Error(`No open run ${runId}`)
  return entries.push(entry) - 1
}

export function entryCount(runId: string): number {
  return runs.get(runId)?.length ?? 0
}

export function updateEntry(runId: string, index: number, update: Partial<CallRecordEntry>): void {
  const entry = runs.get(runId)?.[index]
  if (entry) Object.assign(entry, update)
}

/**
 * Close the run and return its entries. A request still marked dispatched got
 * no answer before the run ended, so whether Google applied it is unknown.
 */
export function closeRun(runId: string): CallRecordEntry[] {
  const entries = runs.get(runId) ?? []
  runs.delete(runId)
  return entries.map((entry) =>
    entry.status === 'dispatched' ? { ...entry, status: 'indeterminate' } : entry
  )
}
