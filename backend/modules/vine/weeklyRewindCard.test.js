import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  getAnniversaryPeriod,
  getMonthlyRewindPeriod,
  getWeeklyRewindPeriod,
  getYearlyRewindPeriod,
  renderRewindCardSvg,
  renderWeeklyRewindCardSvg,
} from "./weeklyRewindCard.js";

test("weekly rewind uses Monday as its stable share key", () => {
  const period = getWeeklyRewindPeriod(new Date("2026-09-11T08:00:00.000Z"));
  assert.equal(period.weekKey, "2026-09-07");
});

test("monthly rewind opens on the 28th and uses a stable month key", () => {
  assert.equal(getMonthlyRewindPeriod(new Date("2026-09-27T08:00:00Z")).available, false);
  const period = getMonthlyRewindPeriod(new Date("2026-09-28T08:00:00Z"));
  assert.equal(period.available, true);
  assert.equal(period.periodKey, "2026-09");
  assert.equal(period.start.getDate(), 1);
});

test("yearly rewind covers the end-of-year and early-January window", () => {
  const december = getYearlyRewindPeriod(new Date("2026-12-25T08:00:00Z"));
  assert.equal(december.available, true);
  assert.equal(december.periodKey, "2026");
  const january = getYearlyRewindPeriod(new Date("2027-01-05T08:00:00Z"));
  assert.equal(january.available, true);
  assert.equal(january.periodKey, "2026");
  assert.equal(getYearlyRewindPeriod(new Date("2027-01-06T08:00:00Z")).available, false);
});

test("anniversary celebration opens for seven days after the join-date anniversary", () => {
  const anniversary = getAnniversaryPeriod("2025-09-11T10:00:00Z", new Date("2026-09-11T08:00:00Z"));
  assert.equal(anniversary.available, true);
  assert.equal(anniversary.years, 1);
  assert.equal(anniversary.periodKey, "2026");
  assert.equal(getAnniversaryPeriod("2025-09-11T10:00:00Z", new Date("2026-09-18T08:00:00Z")).available, false);
  assert.equal(getAnniversaryPeriod("2026-09-11T10:00:00Z", new Date("2026-09-11T08:00:00Z")).available, false);
});

test("leap-day anniversaries celebrate on February 28 in non-leap years", () => {
  const anniversary = getAnniversaryPeriod("2024-02-29T10:00:00Z", new Date("2025-02-28T08:00:00Z"));
  assert.equal(anniversary.available, true);
  assert.equal(anniversary.years, 1);
});

test("weekly rewind artwork escapes profile text and includes stats", () => {
  const svg = renderWeeklyRewindCardSvg({
    displayName: "A < B",
    username: "learner",
    stats: { posts: 7 },
    start: new Date("2026-09-05T00:00:00Z"),
    end: new Date("2026-09-11T00:00:00Z"),
    sharedAt: new Date("2026-09-11T08:00:00Z"),
  });
  assert.match(svg, /A &lt; B/);
  assert.match(svg, />7<\/text>/);
  assert.match(svg, /Weekly Rewind/);
});

test("weekly rewind artwork renders to a feed-ready portrait PNG", async () => {
  const svg = renderWeeklyRewindCardSvg({
    displayName: "No is Safe",
    username: "noissafe",
    stats: { active_days: 6, posts: 4, comments: 12, likes_received: 21, messages: 32, assignments: 2 },
    start: new Date("2026-09-05T00:00:00Z"),
    end: new Date("2026-09-11T00:00:00Z"),
    sharedAt: new Date("2026-09-11T08:00:00Z"),
  });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
});

test("monthly and yearly artwork carry their own Vine identity", () => {
  const monthly = renderRewindCardSvg({
    title: "Monthly Rewind",
    eyebrow: "YOUR MONTH IN BLOOM",
    periodLabel: "MONTHLY",
    periodKey: "2026-09",
    start: new Date("2026-09-01T00:00:00Z"),
    end: new Date("2026-09-30T00:00:00Z"),
    stats: { posts: 4 },
  });
  const yearly = renderRewindCardSvg({
    title: "End-of-Year Rewind",
    eyebrow: "YOUR YEAR IN BLOOM",
    periodLabel: "YEARLY",
    periodKey: "2026",
    start: new Date("2026-01-01T00:00:00Z"),
    end: new Date("2026-12-31T00:00:00Z"),
    stats: { posts: 40 },
  });
  assert.match(monthly, /Monthly Rewind/);
  assert.match(monthly, /MONTHLY · 2026-09/);
  assert.match(yearly, /End-of-Year Rewind/);
  assert.match(yearly, /YEARLY · 2026/);
});

test("anniversary artwork keeps long stat values clear of their labels", () => {
  const svg = renderRewindCardSvg({
    title: "Anniversary",
    eyebrow: "ANOTHER YEAR IN BLOOM",
    periodLabel: "VINE ANNIVERSARY",
    periodKey: "2026",
    statRows: [
      [1, "YEAR ON VINE", "01"],
      [2025, "JOINED", "02"],
      [83, "POSTS", "03"],
      [1, "COMMUNITIES", "04"],
      [7, "FOLLOWERS", "05"],
      [365, "DAYS GROWING", "06"],
    ],
  });
  assert.match(svg, /<text x="206" y="105" class="stat-label">JOINED<\/text>/);
  assert.match(svg, /<text x="168" y="105" class="stat-label">DAYS GROWING<\/text>/);
});
