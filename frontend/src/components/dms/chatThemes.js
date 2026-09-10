export const CHAT_THEMES = [
  { value: "vine", label: "Vine", color: "#07845f" },
  { value: "ocean", label: "Ocean", color: "#1677b8" },
  { value: "berry", label: "Berry", color: "#a83a73" },
  { value: "sunset", label: "Sunset", color: "#d66a2d" },
  { value: "graphite", label: "Graphite", color: "#52606d" },
];

const CHAT_THEME_VALUES = new Set(CHAT_THEMES.map((theme) => theme.value));

export const normalizeChatTheme = (value) =>
  CHAT_THEME_VALUES.has(String(value || "").trim().toLowerCase())
    ? String(value).trim().toLowerCase()
    : "vine";
