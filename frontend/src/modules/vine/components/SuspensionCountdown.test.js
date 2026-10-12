import test from "node:test";
import assert from "node:assert/strict";
import { formatSuspensionTime } from "../utils/suspensionCountdown.js";

test("formats suspension days through seconds", () => {
  assert.equal(formatSuspensionTime(90061), "1d 1h 1m 1s");
});

test("formats shorter suspension sentences without empty units", () => {
  assert.equal(formatSuspensionTime(3661), "1h 1m 1s");
  assert.equal(formatSuspensionTime(61), "1m 1s");
});
