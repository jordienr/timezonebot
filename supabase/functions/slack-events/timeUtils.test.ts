// Tests for time detection and conversion
import { test, expect } from 'vitest';
import { extractTimes, mightHaveTimes } from './timeUtils.ts';

test("mightHaveTimes - should detect valid time patterns", () => {
  expect(mightHaveTimes("Let's meet at 3pm")).toBe(true);
  expect(mightHaveTimes("tomorrow at 14:00")).toBe(true);
  expect(mightHaveTimes("Call me at 9:30am")).toBe(true);
  expect(mightHaveTimes("Meeting at noon")).toBe(true);
  expect(mightHaveTimes("See you at midnight")).toBe(true);
  expect(mightHaveTimes("today at 15:00")).toBe(true);
});

test("mightHaveTimes - should reject invalid patterns", () => {
  expect(mightHaveTimes("see you soon")).toBe(false);
  expect(mightHaveTimes("talk later")).toBe(false);
  expect(mightHaveTimes("hello world")).toBe(false);
});

test("mightHaveTimes - should reject HTTP headers and timestamps", () => {
  // ISO timestamps
  expect(mightHaveTimes("2026-03-25T13:48:20Z")).toBe(false);
  expect(mightHaveTimes("Wed, 25 Mar 2026 13:48:20 GMT")).toBe(false);

  // HTTP response headers
  expect(mightHaveTimes("last-modified: Wed, 25 Mar 2026 08:51:57 GMT")).toBe(false);
  expect(mightHaveTimes("Expires=Wed, 25 Mar 2026 14:18:20 GMT")).toBe(false);

  // Log timestamps
  expect(mightHaveTimes("[2026-03-25 13:48:20]")).toBe(false);
  expect(mightHaveTimes("2026-03-25 13:48:20.123")).toBe(false);
});

test("extractTimes - should extract conversational times", () => {
  let result = extractTimes("Let's meet tomorrow at 3pm");
  expect(result.length).toBe(1);
  expect(result[0].hour).toBe(15);
  expect(result[0].minute).toBe(0);

  result = extractTimes("Call at 9:30am or 2pm");
  expect(result.length).toBe(2);
  expect(result[0].hour).toBe(9);
  expect(result[0].minute).toBe(30);
  expect(result[1].hour).toBe(14);

  result = extractTimes("Meeting at 14:00");
  expect(result.length).toBe(1);
  expect(result[0].hour).toBe(14);
  expect(result[0].minute).toBe(0);
});

test("extractTimes - should NOT extract from HTTP headers", () => {
  const httpResponse = `HTTP/2 200
date: Wed, 25 Mar 2026 13:48:20 GMT
last-modified: Wed, 25 Mar 2026 08:51:57 GMT
Expires=Wed, 25 Mar 2026 14:18:20 GMT`;

  const result = extractTimes(httpResponse);
  expect(result.length).toBe(0);
});

test("extractTimes - should NOT extract from ISO timestamps", () => {
  const result1 = extractTimes("Created at 2026-03-25T13:48:20Z");
  expect(result1.length).toBe(0);

  const result2 = extractTimes("Log: [2026-03-25 13:48:20.123] Error occurred");
  expect(result2.length).toBe(0);
});

test("extractTimes - should extract times with context", () => {
  // These should work - conversational context
  let result = extractTimes("Can we do 15:00 tomorrow?");
  expect(result.length).toBe(1);
  expect(result[0].hour).toBe(15);

  result = extractTimes("How about 8:00?");
  expect(result.length).toBe(1);
  expect(result[0].hour).toBe(8);

  result = extractTimes("Let's sync at 13:48");
  expect(result.length).toBe(1);
  expect(result[0].hour).toBe(13);
  expect(result[0].minute).toBe(48);
});

test("extractTimes - should handle edge cases", () => {
  // Invalid hours/minutes
  expect(extractTimes("at 25:00").length).toBe(0);
  expect(extractTimes("at 12:99").length).toBe(0);

  // Deduplicate same times
  const result = extractTimes("3pm tomorrow, see you at 3pm");
  expect(result.length).toBe(1);
});

test("extractTimes - common false positives", () => {
  // Version numbers
  expect(extractTimes("Vue 3:00 is out").length).toBe(0);
  expect(extractTimes("React 18:00 released").length).toBe(0);

  // Ratios/scores
  expect(extractTimes("The ratio is 3:1").length).toBe(0);
  expect(extractTimes("Score: 15:12").length).toBe(0);

  // Numbers with colons that aren't times
  expect(extractTimes("ID: 1234512:0012345").length).toBe(0);
  expect(extractTimes("Hash: 98765:43210 generated").length).toBe(0);
});

test("extractTimes - should detect timezone abbreviations", () => {
  // Common US timezones
  let result = extractTimes("Meeting at 3pm EST");
  expect(result.length).toBe(1);
  expect(result[0].hour).toBe(15);
  expect(result[0].timezone).toBe("EST");

  result = extractTimes("Call at 2pm PST tomorrow");
  expect(result.length).toBe(1);
  expect(result[0].hour).toBe(14);
  expect(result[0].timezone).toBe("PST");

  result = extractTimes("Sync at 10:30am CST");
  expect(result.length).toBe(1);
  expect(result[0].hour).toBe(10);
  expect(result[0].minute).toBe(30);
  expect(result[0].timezone).toBe("CST");

  // GMT/UTC
  result = extractTimes("Release at 5pm GMT");
  expect(result.length).toBe(1);
  expect(result[0].timezone).toBe("GMT");

  result = extractTimes("Deploy at 14:00 UTC");
  expect(result.length).toBe(1);
  expect(result[0].timezone).toBe("UTC");

  // European
  result = extractTimes("Meeting at 3pm CET");
  expect(result.length).toBe(1);
  expect(result[0].timezone).toBe("CET");

  // Asian
  result = extractTimes("Call at 9am JST");
  expect(result.length).toBe(1);
  expect(result[0].timezone).toBe("JST");
});

test("extractTimes - should handle DST variants", () => {
  let result = extractTimes("Meeting at 3pm EDT");
  expect(result.length).toBe(1);
  expect(result[0].timezone).toBe("EDT");

  result = extractTimes("Call at 2pm PDT");
  expect(result.length).toBe(1);
  expect(result[0].timezone).toBe("PDT");
});
