export const PROFILE_THEMES = Object.freeze([
  { value: "forest", label: "Forest" },
  { value: "ocean", label: "Ocean" },
  { value: "plum", label: "Plum" },
  { value: "sunset", label: "Sunset" },
  { value: "midnight", label: "Midnight" },
  { value: "rose", label: "Rose" },
  { value: "gold", label: "Gold" },
  { value: "graphite", label: "Graphite" },
  { value: "aurora", label: "Aurora" },
  { value: "cherry", label: "Cherry" },
  { value: "cocoa", label: "Cocoa" },
  { value: "ice", label: "Ice" },
]);

const PROFILE_THEME_VALUES = new Set(PROFILE_THEMES.map((theme) => theme.value));

export const resolveProfileTheme = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return PROFILE_THEME_VALUES.has(normalized) ? normalized : "forest";
};
