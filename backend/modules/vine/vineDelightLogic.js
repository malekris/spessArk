const clampCount = (value) => Math.max(0, Number(value || 0));

export const resolveFriendshipCharms = ({
  mutualFollow = false,
  sharedCommunityCount = 0,
  pokeCount = 0,
  directMessageCount = 0,
} = {}) => {
  const charms = [];

  if (mutualFollow) {
    charms.push({
      key: "vine_mutuals",
      emoji: "🤝",
      name: "Vine Mutuals",
      description: "You follow each other.",
    });
  }

  if (clampCount(sharedCommunityCount) > 0) {
    charms.push({
      key: "community_crew",
      emoji: "🌿",
      name: "Community Crew",
      description: `Together in ${clampCount(sharedCommunityCount)} ${clampCount(sharedCommunityCount) === 1 ? "community" : "communities"}.`,
    });
  }

  if (clampCount(pokeCount) >= 1) {
    charms.push({
      key: "poke_pals",
      emoji: "👉",
      name: "Poke Pals",
      description: "A poke has crossed between you.",
    });
  }

  if (clampCount(directMessageCount) >= 100) {
    charms.push({
      key: "conversation_garden",
      emoji: "🌺",
      name: "Conversation Garden",
      description: "100+ messages grown together.",
    });
  } else if (clampCount(directMessageCount) >= 10) {
    charms.push({
      key: "chat_sprouts",
      emoji: "🌱",
      name: "Chat Sprouts",
      description: "Your conversation is taking root.",
    });
  }

  return charms;
};

export const resolveChatPetStage = (messageCount = 0) => {
  const count = clampCount(messageCount);
  if (count >= 80) return { key: "thriving", emoji: "🌻", label: "Thriving", nextAt: null };
  if (count >= 30) return { key: "young", emoji: "🌿", label: "Young vine", nextAt: 80 };
  if (count >= 10) return { key: "sprout", emoji: "🌱", label: "Sprout", nextAt: 30 };
  return { key: "seed", emoji: "🌰", label: "Seed", nextAt: 10 };
};

export const getQuestProgress = (progress, target) => {
  const safeTarget = Math.max(1, Number(target || 1));
  const safeProgress = clampCount(progress);
  return {
    progress: safeProgress,
    target: safeTarget,
    percent: Math.min(100, Math.round((safeProgress / safeTarget) * 100)),
    complete: safeProgress >= safeTarget,
  };
};
