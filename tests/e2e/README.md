# Local integration test

Run `npm run test:e2e` with Node.js, Deno 2 on PATH, and a running Docker daemon. Set `DENO_BIN=/absolute/path/to/deno` if Deno is installed elsewhere. Install project dependencies with `npm ci` first.

The test uses `postgres:17` and `postgrest/postgrest:v14.7`; Docker pulls these images when they are absent. It creates a private Docker network, a fresh PostgreSQL database, and PostgREST, applies the actual migrations, then launches the actual HTTP entry point in a Deno child process. All resources use unique names and containers and database volumes are removed afterward. Ports are selected dynamically.

A local HTTP Slack API double captures ephemeral messages. The Deno launcher redirects Slack requests to that double, strips the Supabase REST gateway prefix for direct PostgREST access, and rejects all other outbound origins. It supplies the Edge Runtime background-task hook so assertions wait for completed event processing. No messages are sent to Slack.

The scenario verifies signed form commands and JSON events, repeated disable, persistence after a Deno process restart, channel and thread recipients, a disabled sender's confirmation while preserving deliveries to others, workspace isolation, re-enable, invalid signatures, anonymous database access denial, and safe behavior during a storage outage.

This suite exercises real Deno, HTTP, PostgreSQL, migrations, and PostgREST. It does not exercise Supabase's hosted gateway or the managed Edge Runtime, and the Slack API responses are controlled test data. The regular `npm test -- --run` suite does not require Docker or Deno.
