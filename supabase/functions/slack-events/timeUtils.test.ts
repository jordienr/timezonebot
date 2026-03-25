// Tests for time detection and conversion
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { extractTimes, mightHaveTimes } from "./timeUtils.ts";

Deno.test("mightHaveTimes - should detect valid time patterns", () => {
  assertEquals(mightHaveTimes("Let's meet at 3pm"), true);
  assertEquals(mightHaveTimes("tomorrow at 14:00"), true);
  assertEquals(mightHaveTimes("Call me at 9:30am"), true);
  assertEquals(mightHaveTimes("Meeting at noon"), true);
  assertEquals(mightHaveTimes("See you at midnight"), true);
  assertEquals(mightHaveTimes("today at 15:00"), true);
});

Deno.test("mightHaveTimes - should reject invalid patterns", () => {
  assertEquals(mightHaveTimes("see you soon"), false);
  assertEquals(mightHaveTimes("talk later"), false);
  assertEquals(mightHaveTimes("hello world"), false);
});

Deno.test("mightHaveTimes - should reject HTTP headers and timestamps", () => {
  // ISO timestamps
  assertEquals(mightHaveTimes("2026-03-25T13:48:20Z"), false);
  assertEquals(mightHaveTimes("Wed, 25 Mar 2026 13:48:20 GMT"), false);

  // HTTP response headers
  assertEquals(mightHaveTimes("last-modified: Wed, 25 Mar 2026 08:51:57 GMT"), false);
  assertEquals(mightHaveTimes("Expires=Wed, 25 Mar 2026 14:18:20 GMT"), false);

  // Log timestamps
  assertEquals(mightHaveTimes("[2026-03-25 13:48:20]"), false);
  assertEquals(mightHaveTimes("2026-03-25 13:48:20.123"), false);
});

Deno.test("extractTimes - should extract conversational times", () => {
  let result = extractTimes("Let's meet tomorrow at 3pm");
  assertEquals(result.length, 1);
  assertEquals(result[0].hour, 15);
  assertEquals(result[0].minute, 0);

  result = extractTimes("Call at 9:30am or 2pm");
  assertEquals(result.length, 2);
  assertEquals(result[0].hour, 9);
  assertEquals(result[0].minute, 30);
  assertEquals(result[1].hour, 14);

  result = extractTimes("Meeting at 14:00");
  assertEquals(result.length, 1);
  assertEquals(result[0].hour, 14);
  assertEquals(result[0].minute, 0);
});

Deno.test("extractTimes - should NOT extract from HTTP headers", () => {
  const httpResponse = `HTTP/2 200
date: Wed, 25 Mar 2026 13:48:20 GMT
last-modified: Wed, 25 Mar 2026 08:51:57 GMT
Expires=Wed, 25 Mar 2026 14:18:20 GMT`;

  const result = extractTimes(httpResponse);
  assertEquals(result.length, 0, "Should not extract times from HTTP headers");
});

Deno.test("extractTimes - should NOT extract from ISO timestamps", () => {
  const result1 = extractTimes("Created at 2026-03-25T13:48:20Z");
  assertEquals(result1.length, 0);

  const result2 = extractTimes("Log: [2026-03-25 13:48:20.123] Error occurred");
  assertEquals(result2.length, 0);
});

Deno.test("extractTimes - should extract times with context", () => {
  // These should work - conversational context
  let result = extractTimes("Can we do 15:00 tomorrow?");
  assertEquals(result.length, 1);
  assertEquals(result[0].hour, 15);

  result = extractTimes("How about 8:00?");
  assertEquals(result.length, 1);
  assertEquals(result[0].hour, 8);

  result = extractTimes("Let's sync at 13:48");
  assertEquals(result.length, 1);
  assertEquals(result[0].hour, 13);
  assertEquals(result[0].minute, 48);
});

Deno.test("extractTimes - should handle edge cases", () => {
  // Invalid hours/minutes
  assertEquals(extractTimes("at 25:00").length, 0);
  assertEquals(extractTimes("at 12:99").length, 0);

  // Deduplicate same times
  const result = extractTimes("3pm tomorrow, see you at 3pm");
  assertEquals(result.length, 1);
});

Deno.test("extractTimes - common false positives", () => {
  // Version numbers
  assertEquals(extractTimes("Vue 3:00 is out").length, 0);
  assertEquals(extractTimes("React 18:00 released").length, 0);

  // Ratios/scores
  assertEquals(extractTimes("The ratio is 3:1").length, 0);
  assertEquals(extractTimes("Score: 15:12").length, 0);
});
