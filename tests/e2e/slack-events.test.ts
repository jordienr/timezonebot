import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

const signingSecret = 'local-signing-secret'
const jwtSecret = 'local-postgrest-signing-secret-at-least-32-characters'
const jwtHeader = Buffer.from(
  JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
).toString('base64url')
function roleToken(role: string) {
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url')
  const signature = createHmac('sha256', jwtSecret)
    .update(`${jwtHeader}.${payload}`)
    .digest('base64url')
  return `${jwtHeader}.${payload}.${signature}`
}
const serviceKey = roleToken('service_role')
const teamId = 'T00000001'
const sender = 'U00000001'
const reader = 'U00000002'
const otherReader = 'U00000003'
const channel = 'C00000001'
const resourcePrefix = `timezone-bot-e2e-${randomUUID()}`
const postgresName = `${resourcePrefix}-postgres`
const restName = `${resourcePrefix}-rest`
const deliveries: Array<Record<string, unknown>> = []
const createdContainers: string[] = []
let apiServer: Server
let entryProcess: ChildProcess
let apiOrigin: string
let restOrigin: string
let entryOrigin: string
let denoPath: string
let networkCreated = false
let sequence = 0
let runtimeOutput = ''

function docker(...args: string[]): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

async function eventually<T>(
  operation: () => Promise<T>,
  accept: (result: T) => boolean,
  timeout = 10000,
): Promise<T> {
  const deadline = Date.now() + timeout
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const result = await operation()
      if (accept(result)) return result
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(
    `Timed out waiting for e2e operation: ${lastError ?? runtimeOutput}`,
  )
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing HTTP port')
  return `http://127.0.0.1:${address.port}`
}

async function stopEntry() {
  if (!entryProcess || entryProcess.exitCode !== null) return
  await new Promise<void>((resolve) => {
    entryProcess.once('exit', () => resolve())
    entryProcess.kill('SIGTERM')
  })
}

async function restartEntry() {
  await stopEntry()
  runtimeOutput = ''
  entryProcess = spawn(
    denoPath,
    ['run', '--allow-net', '--allow-env', 'tests/e2e/serve.ts'],
    {
      env: {
        ...process.env,
        TEST_SLACK_ORIGIN: apiOrigin,
        SLACK_SIGNING_SECRET: signingSecret,
        SLACK_BOT_TOKEN: 'local-bot-token',
        SUPABASE_URL: restOrigin,
        SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  entryProcess.stdout!.on('data', (data) => {
    runtimeOutput += data
  })
  entryProcess.stderr!.on('data', (data) => {
    runtimeOutput += data
  })
  entryOrigin = await eventually(
    async () => runtimeOutput.match(/TEST_PORT=(\d+)/)?.[1],
    Boolean,
  ).then((port) => `http://127.0.0.1:${port}`)
}

async function signedRequest(body: string, contentType: string, valid = true) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')
  const response = await fetch(entryOrigin, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': valid ? `v0=${signature}` : 'v0=invalid',
    },
    body,
  })
  return { status: response.status, text: await response.text() }
}

function command(
  userId: string,
  action: string,
  valid = true,
  workspace = teamId,
) {
  return signedRequest(
    new URLSearchParams({
      command: '/timezonebot',
      text: action,
      team_id: workspace,
      user_id: userId,
      channel_id: channel,
    }).toString(),
    'application/x-www-form-urlencoded',
    valid,
  )
}

async function message(userId = sender, thread = false) {
  deliveries.length = 0
  const result = await signedRequest(
    JSON.stringify({
      type: 'event_callback',
      team_id: teamId,
      event_id: `Ev${++sequence}`,
      event: {
        type: 'message',
        user: userId,
        channel,
        text: 'Meet at 3pm',
        ts: `100.${sequence}`,
        ...(thread ? { thread_ts: '100.0' } : {}),
      },
    }),
    'application/json',
  )
  expect(result.status).toBe(200)
  await eventually(
    async () => runtimeOutput.includes(`TEST_COMPLETE=Ev${sequence}`),
    Boolean,
  )
  return deliveries.map((delivery) => delivery.user).sort()
}

async function storedPreferences() {
  const response = await fetch(
    `${restOrigin}/timezone_bot_preferences?select=team_id,user_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  )
  expect(response.status).toBe(200)
  return response.json()
}

beforeAll(async () => {
  denoPath = process.env.DENO_BIN || 'deno'
  execFileSync(denoPath, ['--version'], { stdio: 'pipe' })
  docker('network', 'create', resourcePrefix)
  networkCreated = true
  docker(
    'run',
    '-d',
    '--name',
    postgresName,
    '--network',
    resourcePrefix,
    '-e',
    'POSTGRES_PASSWORD=local-password',
    'postgres:17',
  )
  createdContainers.push(postgresName)
  await eventually(
    async () =>
      docker(
        'exec',
        postgresName,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
      ),
    (output) => output.includes('accepting connections'),
  )
  const setup =
    "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator LOGIN PASSWORD 'local-password' NOINHERIT; GRANT service_role, anon, authenticated TO authenticator;"
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      postgresName,
      'psql',
      '-U',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: setup, stdio: 'pipe' },
  )
  for (const migration of readdirSync('supabase/migrations')
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    execFileSync(
      'docker',
      [
        'exec',
        '-i',
        postgresName,
        'psql',
        '-U',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      {
        input: readFileSync(join('supabase/migrations', migration)),
        stdio: 'pipe',
      },
    )
  }
  docker(
    'run',
    '-d',
    '--name',
    restName,
    '--network',
    resourcePrefix,
    '-p',
    '127.0.0.1::3000',
    '-e',
    `PGRST_DB_URI=postgres://authenticator:local-password@${postgresName}:5432/postgres`,
    '-e',
    'PGRST_DB_SCHEMAS=public',
    '-e',
    'PGRST_DB_ANON_ROLE=anon',
    '-e',
    `PGRST_JWT_SECRET=${jwtSecret}`,
    'postgrest/postgrest:v14.7',
  )
  createdContainers.push(restName)
  restOrigin = `http://127.0.0.1:${docker('port', restName, '3000/tcp').split(':').at(-1)}`
  await eventually(
    async () => (await fetch(restOrigin)).status,
    (status) => status === 200,
  )
  expect((await fetch(`${restOrigin}/timezone_bot_preferences`)).status).toBe(
    401,
  )
  const authenticatedRead = await fetch(
    `${restOrigin}/timezone_bot_preferences`,
    { headers: { Authorization: `Bearer ${roleToken('authenticated')}` } },
  )
  expect(authenticatedRead.status).toBe(403)
  apiServer = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const url = new URL(request.url!, 'http://localhost')
    let result: unknown
    if (url.pathname === '/api/users.info') {
      const user = url.searchParams.get('user')!
      result = {
        ok: true,
        user: {
          tz: user === sender ? 'Europe/Madrid' : 'America/New_York',
          real_name: user,
          is_bot: false,
        },
      }
    } else if (url.pathname === '/api/conversations.members') {
      result = { ok: true, members: [sender, reader, otherReader] }
    } else if (url.pathname === '/api/conversations.replies') {
      result = {
        ok: true,
        messages: [sender, reader, otherReader].map((user) => ({
          user,
          text: 'Joining',
        })),
      }
    } else if (url.pathname === '/api/chat.postEphemeral') {
      deliveries.push(JSON.parse(Buffer.concat(chunks).toString()))
      result = { ok: true }
    } else {
      response.writeHead(500)
      response.end(`Unexpected Slack request: ${url}`)
      return
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(result))
  })
  apiOrigin = await listen(apiServer)
  await restartEntry()
}, 60000)

afterAll(async () => {
  await stopEntry()
  if (apiServer)
    await new Promise<void>((resolve) => apiServer.close(() => resolve()))
  for (const name of createdContainers.reverse()) docker('rm', '-fv', name)
  if (networkCreated) docker('network', 'rm', resourcePrefix)
})

test('signed personal preferences survive a restart and affect only the chosen user', async () => {
  expect(await message()).toEqual([sender, reader, otherReader].sort())
  const disable = await command(reader, 'disable')
  expect(disable.status).toBe(200)
  expect(JSON.parse(disable.text)).toEqual({
    response_type: 'ephemeral',
    text: expect.stringContaining('messages are disabled'),
  })
  expect(await storedPreferences()).toEqual([
    { team_id: teamId, user_id: reader },
  ])
  const repeatDisable = await command(reader, 'disable')
  expect(repeatDisable.status).toBe(200)
  expect(JSON.parse(repeatDisable.text).text).toContain('messages are disabled')
  expect(await storedPreferences()).toEqual([
    { team_id: teamId, user_id: reader },
  ])
  await restartEntry()
  expect(await message()).toEqual([sender, otherReader].sort())
  expect(await message(sender, true)).toEqual([sender, otherReader].sort())
  expect(deliveries.every((delivery) => delivery.thread_ts === '100.0')).toBe(
    true,
  )
  expect(await message(reader)).toEqual([sender, otherReader].sort())
  expect(
    deliveries.every((delivery) =>
      String(delivery.text).startsWith('🌍 Time conversion'),
    ),
  ).toBe(true)
  expect((await command(reader, 'enable', true, 'T00000002')).status).toBe(200)
  expect(await storedPreferences()).toEqual([
    { team_id: teamId, user_id: reader },
  ])
  expect((await command(reader, 'enable')).status).toBe(200)
  expect(await storedPreferences()).toEqual([])
  expect(await message()).toEqual([sender, reader, otherReader].sort())
  expect((await command(reader, 'disable', false)).status).toBe(401)
  expect(await storedPreferences()).toEqual([])
  const rejected = await signedRequest(
    JSON.stringify({
      type: 'event_callback',
      team_id: teamId,
      event: { type: 'message', user: sender, channel, text: 'Meet at 3pm' },
    }),
    'application/json',
    false,
  )
  expect(rejected.status).toBe(401)
  docker('stop', restName)
  expect(await message()).toEqual([])
  const unavailable = await command(reader, 'disable')
  expect(unavailable.status).toBe(200)
  expect(JSON.parse(unavailable.text)).toEqual({
    response_type: 'ephemeral',
    text: expect.stringContaining('retry'),
  })
})
