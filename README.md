# 🌍 Timezone Bot

Auto-translates time mentions in Slack to each reader's local timezone as a private ephemeral message. No server, no database, no AI costs — one Supabase Edge Function and Slack's built-in timezone data.

## Setup

### 1. Create a Slack App

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. **OAuth & Permissions** → add Bot Token Scopes:
   - `channels:history`, `channels:read`, `chat:write`
   - `groups:history`, `groups:read`, `users:read`
3. **Install App** → install to your workspace → copy the **Bot User OAuth Token** (`xoxb-...`)
4. **Basic Information** → copy the **Signing Secret**
5. **Event Subscriptions** → enable, set Request URL to:
   `https://YOUR_PROJECT.supabase.co/functions/v1/slack-events`
   Subscribe to bot events: `message.channels`, `message.groups`

### 2. Deploy

```bash
supabase link --project-ref YOUR_PROJECT_REF

supabase secrets set SLACK_SIGNING_SECRET=your-signing-secret
supabase secrets set SLACK_BOT_TOKEN=xoxb-your-bot-token

supabase functions deploy slack-events
```

### 3. Add the bot to channels

In Slack: `/invite @TimezoneBot`

That's it. No database, no install flow — the token lives as a Supabase secret.

---

## Supported time formats

Use clear formats and the bot handles the rest:

| You write | Detected |
|---|---|
| `tomorrow at 2pm` | ✅ |
| `Monday at 14:00` | ✅ |
| `today at 9:30am` | ✅ |
| `next Friday at noon` | ✅ |
| `at 3pm` | ✅ |
| `17:30` | ✅ |
| `noon` / `midnight` | ✅ |
| `soon` / `later` | ❌ too vague |

## Local dev

```bash
cp supabase/functions/.env.example supabase/functions/.env.local
# fill in your credentials

supabase functions serve --env-file supabase/functions/.env.local

# expose to Slack via ngrok
ngrok http 54321
```

## Files

```
supabase/functions/
├── _shared/timeUtils.ts      # Regex extraction + timezone conversion
├── slack-events/index.ts     # Webhook handler
└── .env.example
```
