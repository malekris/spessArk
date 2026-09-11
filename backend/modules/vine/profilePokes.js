export const getPokePair = (firstUserId, secondUserId) => {
  const first = Number(firstUserId);
  const second = Number(secondUserId);
  return {
    userLowId: Math.min(first, second),
    userHighId: Math.max(first, second),
  };
};

export const resolvePokeState = ({ viewerId, lastPokerId, lastPokedId }) => {
  const viewer = Number(viewerId);
  if (Number(lastPokerId) === viewer) return "poked";
  if (Number(lastPokedId) === viewer) return "poke_back";
  return "available";
};
