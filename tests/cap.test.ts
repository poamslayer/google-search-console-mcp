import { describe, expect, it } from 'vitest'
import { callTool, toolText } from './helpers/mcp'
import { login } from './helpers/auth'

// vitest.config.ts sets DAILY_EXECUTE_CAP to 20.
describe('the daily cap', () => {
  it('refuses the run after the cap for one user and leaves other users alone', async () => {
    const first = await login({ sub: 'cap-user-a' })
    const second = await login({ sub: 'cap-user-b' })
    const run = (token: string) => callTool('execute', { code: `async () => "ran"` }, token)

    for (let i = 0; i < 20; i++) expect((await run(first.accessToken)).result?.isError).toBeFalsy()
    const refused = await run(first.accessToken)
    expect(refused.result?.isError).toBe(true)
    expect(toolText(refused)).toContain('daily limit of 20')

    expect((await run(second.accessToken)).result?.isError).toBeFalsy()
  })
})
