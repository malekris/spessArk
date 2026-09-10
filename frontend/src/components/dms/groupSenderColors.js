const HUES = [158, 213, 338, 38, 271, 185, 8, 90, 235, 308, 55, 130];
const LIGHTNESS = [87, 78, 91, 82, 74];

export function getGroupSenderStyle(slot) {
  const hue = HUES[slot % HUES.length];
  const band = Math.floor(slot / HUES.length);
  const lightness = LIGHTNESS[band % LIGHTNESS.length];
  const saturation = Math.max(40, 78 - band * 5);
  return {
    "--group-bubble-bg": `hsl(${hue} ${saturation}% ${lightness}%)`,
    "--group-bubble-border": `hsl(${hue} 45% ${lightness - 15}%)`,
    "--group-bubble-text": `hsl(${hue} 38% 16%)`,
    "--group-bubble-accent": `hsl(${hue} 72% 27%)`,
    "--group-bubble-dark-bg": `hsl(${hue} ${40 + band * 2}% ${20 + band * 3}%)`,
    "--group-bubble-dark-border": `hsl(${hue} 42% 47%)`,
    "--group-bubble-dark-text": `hsl(${hue} 45% 96%)`,
    "--group-bubble-dark-accent": `hsl(${hue} 80% 82%)`,
  };
}

export function buildGroupSenderStyles(userIds) {
  const ids = [...new Set(userIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
  const used = new Set();
  const result = {};
  // Allocate from the full roster so colors do not depend on message order or viewer.
  for (const id of ids) {
    let slot = id % HUES.length;
    while (used.has(slot)) slot += 1;
    used.add(slot);
    result[id] = getGroupSenderStyle(slot);
  }
  return result;
}
