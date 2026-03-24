// supabase/functions/slack-events/index.ts
// Receives Slack Event API webhooks, responds in < 3s, processes async.

import { convertTime, extractTimes, mightHaveTimes } from "./timeUtils.ts";

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

const userCache = new Map<string, { tz: string; name: string }>();

async function getUserInfo(token: string, userId: string) {
  if (userCache.has(userId)) return userCache.get(userId)!;

  const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const info = {
    tz: data.user?.tz || "UTC",
    name: data.user?.real_name || data.user?.name || userId,
  };
  userCache.set(userId, info);
  return info;
}

// ─── Core processing ─────────────────────────────────────────────────────────

async function processMessage(event: Record<string, string>, token: string) {
  const { user: senderId, channel: channelId, text, thread_ts } = event;

  // 1. Cheap regex pre-filter — bail early if no time pattern detected
  if (!mightHaveTimes(text)) return;

  // 2. Extract time mentions
  const mentions = extractTimes(text);
  if (!mentions.length) return;

  // 3. Get sender's timezone from their Slack profile
  const senderInfo = await getUserInfo(token, senderId);
  const senderTz = senderInfo.tz;

  // 4. Get channel members
  const membersRes = await fetch(
    `https://slack.com/api/conversations.members?channel=${channelId}&limit=200`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const membersData = await membersRes.json();
  const members: string[] = membersData.members || [];

  // 5. For each member, fetch their tz and send ephemeral if different
  // Batch users.info calls in parallel (max 10 at a time to avoid rate limits)
  const otherMembers = members.filter((id) => id !== senderId);

  // Track who actually received a translation for the sender confirmation
  const translatedFor: { name: string; tz: string }[] = [];

  for (let i = 0; i < otherMembers.length; i += 10) {
    const batch = otherMembers.slice(i, i + 10);
    await Promise.all(
      batch.map(async (memberId) => {
        const memberInfo = await getUserInfo(token, memberId);
        const memberTz = memberInfo.tz;

        if (memberTz === senderTz) return;

        const conversions = mentions
          .map((m) => convertTime(m, senderTz, memberTz))
          .filter(Boolean) as { original: string; converted: string }[];

        if (!conversions.length) return;

        const lines = conversions
          .map((c) => `• *${c.original}* → *${c.converted}*`)
          .join("\n");

        await fetch("https://slack.com/api/chat.postEphemeral", {
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
                  text: `*${senderInfo.name}* is in *${
                    senderTz.replace(/_/g, " ")
                  }*. In your timezone (*${
                    memberTz.replace(/_/g, " ")
                  }*):\n\n${lines}`,
                },
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `_"${text.substring(0, 100)}${
                      text.length > 100 ? "…" : ""
                    }"_`,
                  },
                ],
              },
            ],
          }),
        });

        translatedFor.push({ name: memberInfo.name, tz: memberTz });
      }),
    );
  }

  // 6. Send confirmation back to the sender
  if (translatedFor.length === 0) return;

  const mentionList = mentions.map((m) => `\`${m.original}\``).join(", ");
  const recipientLines = translatedFor
    .map((r) => `• *${r.name}* — ${r.tz.replace(/_/g, " ")}`)
    .join("\n");

  await fetch("https://slack.com/api/chat.postEphemeral", {
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
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.text();

  // Verify the request is genuinely from Slack
  const valid = await verifySlackSignature(req, body);
  if (!valid) return new Response("Unauthorized", { status: 401 });

  const payload = JSON.parse(body);

  // Slack URL verification challenge (one-time setup)
  if (payload.type === "url_verification") {
    return new Response(JSON.stringify({ challenge: payload.challenge }), {
      headers: { "Content-Type": "application/json" },
    });
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
