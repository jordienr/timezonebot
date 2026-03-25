// Shared time utilities — no dependencies, pure Deno/TS

export interface TimeMention {
  original: string;
  hour: number;
  minute: number;
  dayOffset: number; // 0=today, 1=tomorrow, 2=day after, etc.
  weekday?: number;  // 0=Sun..6=Sat, set when a day name matched
}

export interface Conversion {
  original: string;
  converted: string; // human-readable in reader's tz
}

// ─── Regex pre-filter ────────────────────────────────────────────────────────
// Quick bail-out: does the message even contain a time-like pattern?
const PREFILTER = /\b(\d{1,2}:\d{2}|\d{1,2}\s*(am|pm)|noon|midnight|tomorrow|today)\b/i;

// Max input length to prevent ReDoS attacks
const MAX_TEXT_LENGTH = 5000;

export function mightHaveTimes(text: string): boolean {
  if (!text || text.length > MAX_TEXT_LENGTH) return false;
  return PREFILTER.test(text);
}

// ─── Full extraction ─────────────────────────────────────────────────────────
const WEEKDAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

// Matches patterns like:
//   tomorrow at 3pm | today at 14:00 | Monday at 9am | next Friday 17:30
//   at 3pm | at 14:00 | 3pm | 9:30am | noon | midnight
const TIME_RE =
  /(?:(today|tomorrow|next\s+\w+|\b(?:mon|tues?|wednes?|thurs?|fri|satur?|sun)(?:day)?)\s+(?:at\s+)?)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)|(?:(today|tomorrow|next\s+\w+|\b(?:mon|tues?|wednes?|thurs?|fri|satur?|sun)(?:day)?)\s+(?:at\s+)?)?(?:at\s+)?(\d{1,2}):(\d{2})(?!\s*(?:am|pm))|\b(noon|midnight)\b/gi;

export function extractTimes(text: string): TimeMention[] {
  // Prevent ReDoS by limiting input length
  if (!text || text.length > MAX_TEXT_LENGTH) return [];

  const results: TimeMention[] = [];
  let match: RegExpExecArray | null;
  TIME_RE.lastIndex = 0;

  // Safety: limit iterations to prevent infinite loops
  let iterations = 0;
  const MAX_ITERATIONS = 50;

  while ((match = TIME_RE.exec(text)) !== null && iterations++ < MAX_ITERATIONS) {
    const full = match[0];

    // noon / midnight shorthand
    if (match[8]) {
      results.push({
        original: full,
        hour: match[8].toLowerCase() === "noon" ? 12 : 0,
        minute: 0,
        dayOffset: 0,
      });
      continue;
    }

    // Figure out hour/minute
    let hour: number;
    let minute = 0;
    let dayStr: string | undefined;

    if (match[2] !== undefined) {
      // 12-hour form: group 1=day, 2=hour, 3=minute, 4=am/pm
      hour = parseInt(match[2]);
      minute = match[3] ? parseInt(match[3]) : 0;
      const meridiem = match[4]?.toLowerCase();
      if (meridiem === "pm" && hour !== 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;
      dayStr = match[1];
    } else {
      // 24-hour form: group 5=day, 6=hour, 7=minute
      hour = parseInt(match[6]);
      minute = parseInt(match[7]);
      dayStr = match[5];
    }

    if (hour > 23 || minute > 59) continue;

    const mention: TimeMention = { original: full, hour, minute, dayOffset: 0 };

    if (dayStr) {
      const d = dayStr.toLowerCase().trim();
      if (d === "tomorrow") {
        mention.dayOffset = 1;
      } else if (d === "today") {
        mention.dayOffset = 0;
      } else {
        // Find weekday name
        const wdIndex = WEEKDAYS.findIndex((w) => d.startsWith(w.slice(0, 3)));
        if (wdIndex !== -1) mention.weekday = wdIndex;
      }
    }

    results.push(mention);
  }

  // Deduplicate by original text
  return results.filter(
    (m, i, arr) => arr.findIndex((x) => x.original === m.original) === i
  );
}

// ─── Conversion ──────────────────────────────────────────────────────────────

export function convertTime(
  mention: TimeMention,
  senderTz: string,
  readerTz: string
): Conversion | null {
  try {
    // Build a Date in the sender's timezone representing the mentioned time
    const nowInSender = new Date(
      new Date().toLocaleString("en-US", { timeZone: senderTz })
    );

    let targetDate = new Date(nowInSender);
    targetDate.setHours(mention.hour, mention.minute, 0, 0);

    if (mention.weekday !== undefined) {
      const currentDay = nowInSender.getDay();
      let daysUntil = (mention.weekday - currentDay + 7) % 7;
      if (daysUntil === 0) daysUntil = 7; // "Monday" means next Monday if today is Monday
      targetDate.setDate(nowInSender.getDate() + daysUntil);
    } else {
      targetDate.setDate(nowInSender.getDate() + mention.dayOffset);
    }

    // Re-express as a UTC timestamp, correcting for sender tz offset
    const senderOffset = getTimezoneOffset(senderTz, targetDate);
    const utcMs = targetDate.getTime() - senderOffset;
    const utcDate = new Date(utcMs);

    // Format in reader's timezone
    const readerOffset = getTimezoneOffset(readerTz, utcDate);
    const readerMs = utcMs + readerOffset;
    const readerDate = new Date(readerMs);

    const converted = formatTime(readerDate, readerTz, utcDate);
    return { original: mention.original, converted };
  } catch {
    return null;
  }
}

function getTimezoneOffset(tz: string, date: Date): number {
  // Compare UTC time to the local time expressed in tz
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: tz });
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}

function formatTime(readerDate: Date, readerTz: string, utcDate: Date): string {
  const todayInReader = new Date(
    new Date().toLocaleString("en-US", { timeZone: readerTz })
  );
  todayInReader.setHours(0, 0, 0, 0);

  const targetDay = new Date(readerDate);
  targetDay.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (targetDay.getTime() - todayInReader.getTime()) / 86400000
  );

  const timeStr = readerDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (diffDays === 0) return timeStr;
  if (diffDays === 1) return `tomorrow ${timeStr}`;
  if (diffDays === -1) return `yesterday ${timeStr}`;

  const dayName = readerDate.toLocaleDateString("en-US", { weekday: "long" });
  return `${dayName} ${timeStr}`;
}
