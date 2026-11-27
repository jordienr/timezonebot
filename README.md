# 🌍 Timezone Bot

Auto-translates time mentions in Slack to each reader's local timezone as a private ephemeral message. One Supabase Edge Function uses Slack's built-in timezone data, with a small Postgres table for personal notification preferences. No AI costs.

## Prerequisites

- A [Supabase](https://supabase.com) account (free tier works)
- Admin access to a Slack workspace
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) installed

## Setup (5 minutes)

### 1. Create a Slack App (initial setup)

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. **OAuth & Permissions** → add Bot Token Scopes:
   - `channels:history`, `channels:read`, `chat:write`
   - `groups:history`, `groups:read`, `users:read`
3. **Install App** → install to your workspace → copy the **Bot User OAuth Token** (`xoxb-...`)
4. **Basic Information** → copy the **Signing Secret**

⚠️ **Don't configure Event Subscriptions yet** — we need to deploy the function first!

⚠️ **Important:** If you add scopes after installing the app, you MUST **Reinstall to Workspace** to get a new token with the updated permissions. Otherwise the bot will only respond to the installer.

### 2. Apply the database migration and deploy the function

Clone this repo and deploy to your Supabase project:

```bash
git clone https://github.com/jordienr/timezonebot.git
cd timezonebot

# Link to your Supabase project (find PROJECT_REF in your Supabase dashboard URL)
supabase link --project-ref YOUR_PROJECT_REF

# Set your Slack credentials from step 1
supabase secrets set SLACK_SIGNING_SECRET=your-signing-secret
supabase secrets set SLACK_BOT_TOKEN=xoxb-your-bot-token

supabase db push
supabase functions deploy slack-events
```

**Expected result:** You should see `Deployed Functions on project ...` with your function URL.

Apply `supabase/migrations/20261127120000_timezone_bot_preferences.sql` before deploying. The migration creates the workspace/user preference table and restricts access to the backend service role.

Hosted Edge Functions receive `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically. Keep the service role key server-side. If you run the function outside Supabase, provide both variables yourself.

### 3. Configure Slack Event Subscriptions

Now go back to your Slack app settings:

1. Go to **Event Subscriptions** → **Enable Events**
2. Set **Request URL** to your deployed function:
   ```
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/slack-events
   ```
   Replace `YOUR_PROJECT_REF` with your actual Supabase project reference.

   **Expected result:** You should see **"Verified ✓"** next to the URL (this confirms Slack can reach your function)

3. Scroll down to **Subscribe to bot events** and add:
   - `message.channels`
   - `message.groups`

4. Click **Save Changes** at the bottom

**Important:** After saving, Slack may prompt you to reinstall the app. Click **reinstall your app** if you see this message.

### 4. Configure the slash command

In your Slack app settings, open **Slash Commands** → **Create New Command**:

- **Command:** `/timezonebot`
- **Request URL:** the same deployed `slack-events` URL used for Event Subscriptions
- **Short description:** Manage your Timezone Bot messages
- **Usage hint:** `disable | enable`

Save the command and reinstall the app to your workspace if Slack prompts you to approve the `commands` permission. The function verifies Slack's signature against the original form body before reading or changing preferences.

### 5. Use the bot

In each channel where you want timezone translation, invite the bot:

```
/invite @YourBotName
```

Replace `YourBotName` with whatever you named your Slack app in step 1.

**Test it:** Send a message like `Let's meet tomorrow at 3pm` and you should see a private ephemeral message with the time converted to your timezone.

**Important:** The bot only listens to channels it's been explicitly invited to. It has no access to other channels in your workspace. This is a Slack security feature - you control which channels the bot can see.

---

**That's it!** The bot is now running. Everyone in the channel will automatically see time conversions in their own timezone.

---

## How it works

When someone mentions a time in Slack, the bot:
1. Detects time patterns in messages automatically
2. Sends each person a private ephemeral message (only visible to them) with the time converted to their timezone
3. Everyone sees the conversion that applies to them - no clutter in the channel
4. **Thread-aware:** In threads, only translates for people who participated or were @mentioned (not the whole channel)

The bot uses each user's timezone from their Slack profile, so setup is instant after inviting it to a channel.

### Examples

**Channel messages - Sender's view**

When you mention a time, you see who received translations:

<img src="static/sender_pov.png" width="600" alt="Sender's view showing confirmation of who received time translations">

**Channel messages - Receiver's view**

Others see the time converted to their timezone:

<img src="static/receiver_pov.png" width="600" alt="Receiver's view showing time converted to their timezone">

**Thread awareness - Sender's view**

In threads, only people who participated or were @mentioned in the thread receive translations. Your confirmation message lists exactly who received the translation (not the entire channel):

<img src="static/thread_intelligence_sender_pov.png" width="600" alt="Thread sender view showing only thread participants received translations">

**Thread awareness - Receiver's view**

Thread participants see clean, focused translations:

<img src="static/thread_intelligence_receiver_pov.png" width="600" alt="Thread receiver view showing timezone conversion">

## Personal preferences

Run `/timezonebot disable` to stop all Timezone Bot messages to you in that workspace, including channel translations, thread translations, and sender confirmations. Run `/timezonebot enable` to receive messages again. Responses are private ephemeral messages. Both commands are safe to repeat.

Your messages still generate translations for teammates who have messages enabled. Disabling messages affects only your own deliveries. Everyone receives messages by default until they disable them.

An empty or unsupported command shows usage. If storage is unavailable, the command asks you to retry without claiming success.

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
| `3pm EST` / `14:00 PST` | ✅ With timezone |
| `soon` / `later` | ❌ too vague |

### Timezone abbreviations

Specify a timezone to override your local timezone:

**Supported abbreviations:**
- **US:** EST, EDT, CST, CDT, MST, MDT, PST, PDT
- **International:** GMT, UTC, BST
- **Europe:** CET, CEST
- **Asia:** IST, JST, KST
- **Australia:** AEST, AEDT, AWST

**Example:** If you say "Meeting at 3pm EST", everyone sees it converted from Eastern Time, regardless of where you are.

## Local dev

```bash
cp env.example .env.local
# Fill in your SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN

supabase start
supabase migration up --local
supabase functions serve --env-file .env.local

# Expose to Slack via ngrok or similar
ngrok http 54321
# Update your Slack Event Subscriptions URL to the ngrok URL
```

## Privacy & Data Handling

The bot processes message text in memory to extract times and does not store messages or conversation history. It calls Slack for profiles, channel membership, thread participants, and private ephemeral delivery, and Supabase for notification preferences.

Postgres stores only the Slack workspace ID and user ID for each disabled preference. Enabling messages deletes that row. Preferences are scoped to the workspace, persist across deployments, and are accessible through the backend service role only. Preference lookups are batched before any recipient delivery; if a lookup fails, that event sends no messages.

Function logs include user names, user IDs, timezones, channel/thread identifiers, and Slack API status information for debugging. Treat logs as sensitive operational data and configure retention accordingly. Message content is processed in memory and is never intentionally persisted by the bot.

The bot receives events only from channels where it has been invited and has no access to other channels in the workspace. Personal preferences control deliveries; they do not stop processing times in messages you send for teammates who still receive translations.

## Troubleshooting

### Bot only responds to me (the installer)

This happens when you added OAuth scopes after installing the app. Slack doesn't automatically upgrade permissions for existing installations.

**Solution:**
1. Go to **OAuth & Permissions** in your Slack app settings
2. Click **Reinstall to Workspace** at the top
3. Copy the new Bot User OAuth Token
4. Update your secret: `supabase secrets set SLACK_BOT_TOKEN=xoxb-new-token`
5. In the Slack channel, kick the bot: `/remove @YourBotName`
6. Re-invite the bot: `/invite @YourBotName`

The kick + re-invite ensures Slack refreshes the bot's permissions in that channel.

### Bot isn't detecting times

Make sure you're using clear time formats:
- ✅ `3pm`, `15:00`, `tomorrow at 2pm`
- ❌ `later`, `soon`, `in a bit`

The bot requires explicit times with hours (and optionally minutes).

### Bot isn't responding at all

1. Check your function is deployed: `supabase functions list`
2. Check the function logs: `supabase functions logs slack-events`
3. Verify Event Subscriptions shows "Verified ✓" in your Slack app settings
4. Try kicking and re-inviting the bot to the channel (see above)

## Development

### Running tests

The time detection logic has comprehensive tests to prevent regressions:

```bash
npm install  # Install dependencies (first time only)
npm run test # Run all tests with vitest
```

Tests cover:
- Valid conversational times (3pm, tomorrow at 14:00, etc.)
- Exclusion of HTTP headers, ISO timestamps, and log formats
- Edge cases (invalid times, deduplication)
- False positives (version numbers like "Vue 3:00", ratios like "Score: 15:12")

### End-to-end tests

Install Deno and start Docker, then run `npm run test:e2e`. The suite starts disposable PostgreSQL 17 and PostgREST containers, applies the production migration, and serves the production webhook in Deno against a local Slack API double. It verifies signed commands, durable preferences, recipient filtering, and database access restrictions without contacting a Slack workspace.

The harness uses `deno` from your PATH. To specify another installation, run `DENO_BIN=/absolute/path/to/deno npm run test:e2e`. Docker needs network access to download images on the first run.

### Files

```
supabase/functions/slack-events/
├── index.ts            # Webhook handler + Slack API calls
├── preferences.ts      # Durable workspace/user preferences
├── timeUtils.ts        # Time pattern extraction + timezone conversion
├── timeUtils.test.ts   # Test suite for time detection
└── deno.json           # Deno configuration
```
