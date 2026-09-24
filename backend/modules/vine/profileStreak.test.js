import test from "node:test";
import assert from "node:assert/strict";
import { calculateConsecutiveDayStreak } from "./profileStreak.js";

test("counts a streak through today", () => {
  assert.equal(
    calculateConsecutiveDayStreak(["2026-09-21", "2026-09-20", "2026-09-19"], "2026-09-21"),
    3
  );
});

test("keeps yesterday's streak before today's first visit", () => {
  assert.equal(
    calculateConsecutiveDayStreak(["2026-09-20", "2026-09-19", "2026-09-18"], "2026-09-21"),
    3
  );
});

test("stops at the first missed day", () => {
  assert.equal(
    calculateConsecutiveDayStreak(["2026-09-21", "2026-09-20", "2026-09-18"], "2026-09-21"),
    2
  );
});

test("ignores duplicate and invalid activity days", () => {
  assert.equal(
    calculateConsecutiveDayStreak(["2026-09-21", "2026-09-21", null, "bad"], "2026-09-21"),
    1
  );
});

test("accepts MySQL DATE values decoded as JavaScript Date objects", () => {
  assert.equal(
    calculateConsecutiveDayStreak(
      [
        { day: new Date("2026-09-21T00:00:00.000Z") },
        { day: new Date("2026-09-20T00:00:00.000Z") },
      ],
      "2026-09-21"
    ),
    2
  );
});
