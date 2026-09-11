import test from "node:test";
import assert from "node:assert/strict";
import { getPokePair, resolvePokeState } from "./profilePokes.js";

test("normalizes a poke relationship into one stable pair", () => {
  assert.deepEqual(getPokePair(12, 4), { userLowId: 4, userHighId: 12 });
  assert.deepEqual(getPokePair(4, 12), { userLowId: 4, userHighId: 12 });
});

test("shows the correct profile action for each side of a poke", () => {
  assert.equal(resolvePokeState({ viewerId: 4, lastPokerId: 4, lastPokedId: 12 }), "poked");
  assert.equal(resolvePokeState({ viewerId: 12, lastPokerId: 4, lastPokedId: 12 }), "poke_back");
  assert.equal(resolvePokeState({ viewerId: 7 }), "available");
});
