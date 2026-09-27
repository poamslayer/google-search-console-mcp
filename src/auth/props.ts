import { z } from 'zod'

export const AUTH_PROPS_VERSION = 1

/** What a login grant carries. The provider stores it encrypted in KV; the sandbox never sees it. */
export const AuthProps = z.object({
  version: z.literal(AUTH_PROPS_VERSION),
  user: z.object({ id: z.string(), email: z.string() }),
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  accessLevel: z.enum(['read-only', 'full'])
})
export type AuthProps = z.infer<typeof AuthProps>
