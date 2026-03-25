# 🌍 Timezone Bot

Auto-translates time mentions in Slack to each reader's local timezone as a private ephemeral message. No server, no database, no AI costs — one Supabase Edge Function and Slack's built-in timezone data.

## Setup

### 1. Create a Slack App (initial setup)

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. **OAuth & Permissions** → add Bot Token Scopes:
   - `channels:history`, `channels:read`, `chat:write`
   - `groups:history`, `groups:read`, `users:read`
3. **Install App** → install to your workspace → copy the **Bot User OAuth Token** (`xoxb-...`)
4. **Basic Information** → copy the **Signing Secret**

⚠️ **Don't configure Event Subscriptions yet** — we need to deploy the function first!

⚠️ **Important:** If you add scopes after installing the app, you MUST **Reinstall to Workspace** to get a new token with the updated permissions. Otherwise the bot will only respond to the installer.

### 2. Deploy the Function

```bash
supabase link --project-ref YOUR_PROJECT_REF

supabase secrets set SLACK_SIGNING_SECRET=your-signing-secret
supabase secrets set SLACK_BOT_TOKEN=xoxb-your-bot-token

supabase functions deploy slack-events
```

### 3. Configure Slack Event Subscriptions

Now go back to your Slack app:

1. **Event Subscriptions** → **Enable Events**
2. Set **Request URL** to:
   ```
   https://YOUR_PROJECT.supabase.co/functions/v1/slack-events
   ```
   (You should see "Verified ✓" when Slack successfully connects)
3. **Subscribe to bot events**: `message.channels`, `message.groups`
4. **Save Changes**

### 4. Add the bot to channels

In each channel where you want timezone translation, type: `/invite @TimezoneBot`

**Important:** The bot only listens to channels it's been explicitly invited to. It has no access to other channels in your workspace. This is a Slack security feature - you control which channels the bot can see.

---

## How it works

When someone mentions a time in Slack, the bot:
1. Detects time patterns in messages automatically
2. Sends each person a private ephemeral message (only visible to them) with the time converted to their timezone
3. Everyone sees the conversion that applies to them - no clutter in the channel

The bot uses each user's timezone from their Slack profile, so setup is instant after inviting it to a channel.

## Supported time formats

Use clear formats and the bot handles the rest:

| You write | Detected |
|---|---|
| `tomorrow at 2pm` | ✅ |
| `Monday at 14:00` | ✅ |
| `today at 9:30am` | ✅ |
| `next Friday at noon` | ✅ |
| `at 3pm` | ✅ |
| `15:00` | ✅ |
| `8:00` | ✅ |
| `17:30` | ✅ |
| `noon` / `midnight` | ✅ |
| `soon` / `later` | ❌ too vague |

## Local dev

```bash
cp env.example .env.local
# Fill in your SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN

supabase functions serve --env-file .env.local

# Expose to Slack via ngrok or similar
ngrok http 54321
# Update your Slack Event Subscriptions URL to the ngrok URL
```

## Privacy & Data Handling

The bot processes messages to detect time patterns, but:
- ✅ **No database** - message content is never stored
- ✅ **No logging** - only user IDs and timezones are logged for debugging
- ✅ **No third parties** - only communicates with Slack APIs
- ✅ **In-memory only** - message text is discarded after processing
- ✅ **Minimal scope** - only requests permissions needed for time detection
- ✅ **Opt-in per channel** - only listens to channels it's explicitly invited to

Message content is processed in-memory to extract times like "3pm" or "15:00", then immediately discarded. The bot never stores conversation history.

The bot only receives events from channels where it's been invited. It has no access to other channels in your workspace.

## Troubleshooting

### Bot only responds to me (the installer)

This happens when you added OAuth scopes after installing the app. Slack doesn't automatically upgrade permissions for existing installations.

**Solution:**
1. Go to **OAuth & Permissions** in your Slack app settings
2. Click **Reinstall to Workspace** at the top
3. Copy the new Bot User OAuth Token
4. Update your secret: `supabase secrets set SLACK_BOT_TOKEN=xoxb-new-token`

### Bot isn't detecting times

Make sure you're using clear time formats:
- ✅ `3pm`, `15:00`, `tomorrow at 2pm`
- ❌ `later`, `soon`, `in a bit`

The bot requires explicit times with hours (and optionally minutes).

## Files

```
supabase/functions/slack-events/
├── index.ts        # Webhook handler + Slack API calls
├── timeUtils.ts    # Time pattern extraction + timezone conversion
└── deno.json       # Deno configuration
```
