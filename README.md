# 🌍 Timezone Bot

Auto-translates time mentions in Slack to each reader's local timezone as a private ephemeral message. No server, no database, no AI costs — one Supabase Edge Function and Slack's built-in timezone data.

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

### 2. Deploy the Function

Clone this repo and deploy to your Supabase project:

```bash
git clone https://github.com/jordienr/timezonebot.git
cd timezonebot

# Link to your Supabase project (find PROJECT_REF in your Supabase dashboard URL)
supabase link --project-ref YOUR_PROJECT_REF

# Set your Slack credentials from step 1
supabase secrets set SLACK_SIGNING_SECRET=your-signing-secret
supabase secrets set SLACK_BOT_TOKEN=xoxb-your-bot-token

# Deploy the function
supabase functions deploy slack-events
```

**Expected result:** You should see `Deployed Functions on project ...` with your function URL.

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

### 4. Use the bot

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

<img src="static/receiver_pov.png" width="600" alt="Sender's view showing confirmation of who received time translations">

**Channel messages - Receiver's view**

Others see the time converted to their timezone:

<img src="static/sender_pov.png" width="600" alt="Receiver's view showing time converted to their timezone">

**Thread intelligence - Sender's view**

In threads, only people who participated or were @mentioned in the thread receive translations. Your confirmation message lists exactly who received the translation (not the entire channel):

<img src="static/thread_intelligence_sender_pov.png" width="600" alt="Thread sender view showing only thread participants received translations">

**Thread intelligence - Receiver's view**

Thread participants see clean, focused translations:

<img src="static/thread_intelligence_receiver_pov.png" width="600" alt="Thread receiver view showing timezone conversion">

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

## Files

```
supabase/functions/slack-events/
├── index.ts        # Webhook handler + Slack API calls
├── timeUtils.ts    # Time pattern extraction + timezone conversion
└── deno.json       # Deno configuration
```
