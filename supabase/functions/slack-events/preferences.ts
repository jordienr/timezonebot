const preferenceBatchSize = 100;

function preferenceRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("Preference storage is not configured");
  }
  return fetch(
    `${url.replace(/\/$/, "")}/rest/v1/timezone_bot_preferences${path}`,
    {
      ...init,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(1500),
    },
  );
}

export async function setDisabled(
  teamId: string,
  userId: string,
  disabled: boolean,
): Promise<void> {
  const query = new URLSearchParams(
    disabled
      ? { on_conflict: "team_id,user_id" }
      : { team_id: `eq.${teamId}`, user_id: `eq.${userId}` },
  );
  const response = await preferenceRequest(
    `?${query}`,
    disabled
      ? {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ team_id: teamId, user_id: userId }),
      }
      : { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(`Could not save preference: HTTP ${response.status}`);
  }
}

export async function getDisabledUsers(
  teamId: string,
  userIds: string[],
): Promise<Set<string>> {
  const disabled = new Set<string>();
  const uniqueUsers = [...new Set(userIds)];
  for (let i = 0; i < uniqueUsers.length; i += preferenceBatchSize) {
    const batch = uniqueUsers.slice(i, i + preferenceBatchSize);
    const query = new URLSearchParams({
      select: "user_id",
      team_id: `eq.${teamId}`,
      user_id: `in.(${batch.join(",")})`,
      limit: String(preferenceBatchSize),
    });
    const response = await preferenceRequest(`?${query}`, {
      headers: { Prefer: "count=exact" },
    });
    if (!response.ok) {
      throw new Error(`Could not read preferences: HTTP ${response.status}`);
    }
    const rows: unknown = await response.json();
    const total = response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
    if (
      total === undefined || !Array.isArray(rows) ||
      rows.length !== Number(total) || rows.some((row) =>
        !row || typeof row.user_id !== "string" || !batch.includes(row.user_id)
      )
    ) {
      throw new Error("Invalid preference response");
    }
    for (const row of rows) {
      disabled.add(row.user_id);
    }
  }
  return disabled;
}
