// supabase/functions/slack-events/index.ts
// Receives Slack Event API webhooks, responds in < 3s, processes async.

import { convertTime, extractTimes, mightHaveTimes } from "./timeUtils.ts";

// ─── Input validation ────────────────────────────────────────────────────────

function isValidSlackUserId(userId: string): boolean {
  // Slack user IDs start with U, W (workspace users), or B (bot users)
  return /^[UWB][A-Z0-9]{8,}$/.test(userId);
}

function isValidSlackChannelId(channelId: string): boolean {
  // Slack channel IDs start with C (channels), G (groups), or D (DMs)
  return /^[CGD][A-Z0-9]{8,}$/.test(channelId);
}

// ─── Slack signature verification ────────────────────────────────────────────

async function verifySlackSignature(
  req: Request,
  body: string,
): Promise<boolean> {
  const signingSecret = Deno.env.get("SLACK_SIGNING_SECRET");
  if (!signingSecret) return false;

  const timestamp = req.headers.get("x-slack-request-timestamp");
  const slackSig = req.headers.get("x-slack-signature");
  if (!timestamp || !slackSig) return false;

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const sigBase = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(sigBase),
  );
  const hex = "v0=" +
    Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return hex === slackSig;
}

// ─── User info cache (per function invocation) ───────────────────────────────

const userCache = new Map<string, { tz: string; name: string; isBot: boolean }>();

async function getUserInfo(token: string, userId: string) {
  if (userCache.has(userId)) return userCache.get(userId)!;

  const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.error(`Slack API HTTP error: ${res.status} for user ${userId}`);
    throw new Error(`Slack API error: ${res.status}`);
  }

  const data = await res.json();

  if (!data.ok) {
    console.error(`Slack API error: ${data.error} for user ${userId}`);
    // Handle rate limiting
    if (data.error === "rate_limited") {
      const retryAfter = res.headers.get("Retry-After");
      console.error(`Rate limited. Retry after: ${retryAfter}s`);
    }
    throw new Error(`Slack API error: ${data.error}`);
  }

  const info = {
    tz: data.user?.tz || "UTC",
    name: data.user?.real_name || data.user?.name || userId,
    isBot: data.user?.is_bot || false,
  };
  userCache.set(userId, info);
  return info;
}

// ─── Core processing ─────────────────────────────────────────────────────────

async function processMessage(event: Record<string, string>, token: string) {
  const { user: senderId, channel: channelId, text, thread_ts } = event;

  // 0. Validate Slack IDs
  if (!isValidSlackUserId(senderId)) {
    console.error(`Invalid user ID format: ${senderId}`);
    return;
  }
  if (!isValidSlackChannelId(channelId)) {
    console.error(`Invalid channel ID format: ${channelId}`);
    return;
  }

  // 1. Cheap regex pre-filter — bail early if no time pattern detected
  if (!mightHaveTimes(text)) return;

  // 2. Extract time mentions
  const mentions = extractTimes(text);
  if (!mentions.length) return;

  // 3. Get sender's timezone from their Slack profile
  const senderInfo = await getUserInfo(token, senderId);
  const senderTz = senderInfo.tz;
  console.log(`Sender ${senderInfo.name} timezone: ${senderTz}`);

  // 4. Get channel members (with pagination)
  const members: string[] = [];
  let cursor: string | undefined;
  let attempts = 0;
  const MAX_PAGES = 10; // Limit to 2000 members (200 * 10)

  do {
    const url = cursor
      ? `https://slack.com/api/conversations.members?channel=${channelId}&limit=200&cursor=${cursor}`
      : `https://slack.com/api/conversations.members?channel=${channelId}&limit=200`;

    const membersRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!membersRes.ok) {
      console.error(`Slack API HTTP error: ${membersRes.status} for channel ${channelId}`);
      throw new Error(`Slack API error: ${membersRes.status}`);
    }

    const membersData = await membersRes.json();

    if (!membersData.ok) {
      console.error(`Slack API error: ${membersData.error} for channel ${channelId}`);
      if (membersData.error === "rate_limited") {
        const retryAfter = membersRes.headers.get("Retry-After");
        console.error(`Rate limited. Retry after: ${retryAfter}s`);
      }
      throw new Error(`Slack API error: ${membersData.error}`);
    }

    members.push(...(membersData.members || []));
    cursor = membersData.response_metadata?.next_cursor;
    attempts++;
  } while (cursor && attempts < MAX_PAGES);

  // 5. For each member, fetch their tz and send ephemeral if different
  // Batch users.info calls in parallel (max 10 at a time to avoid rate limits)
  const otherMembers = members
    .filter((id) => id !== senderId)
    .filter(isValidSlackUserId);

  // Track who actually received a translation for the sender confirmation
  const translatedFor: { name: string; tz: string; conversions: string[] }[] = [];

  for (let i = 0; i < otherMembers.length; i += 10) {
    const batch = otherMembers.slice(i, i + 10);
    await Promise.all(
      batch.map(async (memberId) => {
        const memberInfo = await getUserInfo(token, memberId);

        // Skip bots (including the timezone bot itself)
        if (memberInfo.isBot) {
          console.log(`Skipping bot: ${memberInfo.name}`);
          return;
        }

        const memberTz = memberInfo.tz;
        console.log(`Member ${memberInfo.name} timezone: ${memberTz} (sender: ${senderTz})`);

        const isSameTimezone = memberTz === senderTz;

        let messageBlocks;
        let times: string[];

        if (isSameTimezone) {
          // Same timezone - just list the times without conversion
          times = mentions.map((m) => m.original);
          const timesList = times.map((t) => `\`${t}\``).join(", ");

          messageBlocks = [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${timesList}\n\nSame timezone as *${senderInfo.name}* (${
                  memberTz.replace(/_/g, " ")
                })`,
              },
            },
          ];
        } else {
          // Different timezone - convert times
          const conversions = mentions
            .map((m) => convertTime(m, senderTz, memberTz))
            .filter(Boolean) as { original: string; converted: string }[];

          if (!conversions.length) return;

          times = conversions.map((c) => c.converted);
          const lines = conversions
            .map((c) => `\`${c.original}\` for you is \`${c.converted}\``)
            .join("\n");

          messageBlocks = [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${lines}\n\nTranslated from *${senderInfo.name}* who is in ${
                  senderTz.replace(/_/g, " ")
                }`,
              },
            },
          ];
        }

        console.log(`Sending ephemeral to ${memberInfo.name} (${memberId}) in channel ${channelId}`);

        const ephemeralRes = await fetch("https://slack.com/api/chat.postEphemeral", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: channelId,
            user: memberId,
            thread_ts: thread_ts || undefined,
            text: `🌍 Time conversion from ${senderInfo.name}`,
            blocks: messageBlocks,
          }),
        });

        if (ephemeralRes.ok) {
          const ephemeralData = await ephemeralRes.json();
          if (ephemeralData.ok) {
            console.log(`✓ Successfully sent ephemeral to ${memberInfo.name} (${memberId})`);
            translatedFor.push({
              name: memberInfo.name,
              tz: memberTz,
              conversions: times,
            });
          } else {
            console.error(`✗ Failed to send ephemeral to ${memberInfo.name} (${memberId}): ${ephemeralData.error}`);
            console.error(`Response:`, JSON.stringify(ephemeralData));
          }
        } else {
          console.error(`✗ HTTP error sending ephemeral to ${memberInfo.name} (${memberId}): ${ephemeralRes.status}`);
        }
      }),
    );
  }

  // 6. Send confirmation back to the sender
  if (translatedFor.length === 0) return;

  const mentionList = mentions.map((m) => `\`${m.original}\``).join(", ");
  const recipientLines = translatedFor
    .map((r) => {
      const times = r.conversions.map((c) => `*${c}*`).join(", ");
      return `• *${r.name}* (${r.tz.replace(/_/g, " ")}) — ${times}`;
    })
    .join("\n");

  const confirmRes = await fetch("https://slack.com/api/chat.postEphemeral", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      user: senderId,
      thread_ts: thread_ts || undefined,
      text: `🌍 Your times were translated for your teammates`,
      blocks: [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "🌍 *Timezone Translator* · Only visible to you",
            },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `${mentionList} was translated into the local time for:\n\n${recipientLines}`,
          },
        },
      ],
    }),
  });

  if (!confirmRes.ok) {
    console.error(`Failed to send confirmation to sender: HTTP ${confirmRes.status}`);
  } else {
    const confirmData = await confirmRes.json();
    if (!confirmData.ok) {
      console.error(`Failed to send confirmation to sender: ${confirmData.error}`);
    }
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.text();

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (err) {
    console.error("Invalid JSON payload:", err);
    return new Response("Bad Request", { status: 400 });
  }

  // Slack URL verification challenge (one-time setup)
  // Handle this BEFORE signature verification to allow initial setup
  if (payload.type === "url_verification") {
    console.log("Received URL verification challenge");
    return new Response(JSON.stringify({ challenge: payload.challenge }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify the request is genuinely from Slack (after allowing url_verification)
  const valid = await verifySlackSignature(req, body);
  if (!valid) {
    console.error("Invalid Slack signature");
    return new Response("Unauthorized", { status: 401 });
  }

  const event = payload.event;

  // Fire-and-forget: ACK Slack immediately, do work async
  if (
    event?.type === "message" && !event.subtype && !event.bot_id && event.text
  ) {
    const token = Deno.env.get("SLACK_BOT_TOKEN")!;
    (async () => {
      try {
        await processMessage(event, token);
      } catch (err) {
        console.error("processMessage error:", err);
      }
    })();
  }

  return new Response("ok", { status: 200 });
});
