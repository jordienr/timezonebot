const slackOrigin = Deno.env.get('TEST_SLACK_ORIGIN')!
const originalFetch = globalThis.fetch
const pending: Promise<unknown>[] = []

Object.assign(globalThis, {
  EdgeRuntime: {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  },
})

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.origin === 'https://slack.com') {
    return originalFetch(`${slackOrigin}${url.pathname}${url.search}`, init)
  }
  if (url.origin === Deno.env.get('SUPABASE_URL')) {
    url.pathname = url.pathname.replace(/^\/rest\/v1/, '')
    return originalFetch(url, init)
  }
  throw new Error(`External network forbidden during e2e: ${url.origin}`)
}

const serve = Deno.serve.bind(Deno)
Deno.serve = ((handler: Deno.ServeHandler) =>
  serve(
    {
      hostname: '127.0.0.1',
      port: 0,
      onListen: ({ port }) => console.log(`TEST_PORT=${port}`),
    },
    async (request, info) => {
      const body = await request.clone().text()
      const response = await handler(request, info)
      Promise.all(pending.splice(0)).then(() => {
        if (request.headers.get('content-type') === 'application/json') {
          console.log(`TEST_COMPLETE=${JSON.parse(body).event_id}`)
        }
      })
      return response
    },
  )) as typeof Deno.serve

await import('../../supabase/functions/slack-events/index.ts')
