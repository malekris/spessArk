import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupSenderStyles } from "./groupSenderColors.js";

test("assigns distinct light and dark colors even when 50 sender IDs collide", () => {
  const ids = Array.from({ length: 50 }, (_, index) => index * 12 + 1);
  const colors = buildGroupSenderStyles(ids);
  assert.equal(new Set(Object.values(colors).map((style) => style["--group-bubble-bg"])).size, ids.length);
  assert.equal(new Set(Object.values(colors).map((style) => style["--group-bubble-dark-bg"])).size, ids.length);
  assert.deepEqual(buildGroupSenderStyles([...ids].reverse()), colors);
  assert.deepEqual(buildGroupSenderStyles([...ids, ...ids]), colors);
});
