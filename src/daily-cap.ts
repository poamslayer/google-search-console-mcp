/**
 * The daily cap on execute runs per user (ADR-0002). Every user shares the
 * Google Cloud project's quota and the Workers bill, so one user cannot use
 * them all up.
 *
 * KV has no atomic increment, so two runs that start at the same moment can
 * both read the same count. The cap can then be passed by a few runs. That is
 * fine for a cost guard, and it avoids a Durable Object.
 */
export async function takeDailyRun(
  kv: KVNamespace,
  userId: string,
  cap: number,
  now = new Date()
): Promise<{ allowed: true } | { allowed: false; resetsAt: string }> {
  const day = now.toISOString().slice(0, 10)
  const key = `cap:${userId}:${day}`
  const used = Number((await kv.get(key)) ?? '0')
  if (used >= cap) {
    const nextMidnight = new Date(`${day}T00:00:00Z`)
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1)
    return { allowed: false, resetsAt: nextMidnight.toISOString() }
  }
  await kv.put(key, String(used + 1), { expirationTtl: 2 * 24 * 60 * 60 })
  return { allowed: true }
}
