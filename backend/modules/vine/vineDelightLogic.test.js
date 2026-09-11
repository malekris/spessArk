import test from "node:test";
import assert from "node:assert/strict";
import { getQuestProgress, resolveChatPetStage, resolveFriendshipCharms } from "./vineDelightLogic.js";

test("friendship charms reflect shared relationship activity", () => {
  const charms = resolveFriendshipCharms({
    mutualFollow: true,
    sharedCommunityCount: 2,
    pokeCount: 1,
    directMessageCount: 140,
  });
  assert.deepEqual(charms.map((charm) => charm.key), [
    "vine_mutuals",
    "community_crew",
    "poke_pals",
    "conversation_garden",
  ]);
});

test("chat pet stages grow at stable milestones", () => {
  assert.equal(resolveChatPetStage(0).key, "seed");
  assert.equal(resolveChatPetStage(10).key, "sprout");
  assert.equal(resolveChatPetStage(30).key, "young");
  assert.equal(resolveChatPetStage(80).key, "thriving");
});

test("quest progress is capped visually at one hundred percent", () => {
  assert.deepEqual(getQuestProgress(12, 10), {
    progress: 12,
    target: 10,
    percent: 100,
    complete: true,
  });
});
