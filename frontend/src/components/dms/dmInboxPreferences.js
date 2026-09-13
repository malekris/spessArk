export const DM_INBOX_PREFERENCES_EVENT = "vine:dm-inbox-preferences";

export const DEFAULT_DM_INBOX_PREFERENCES = Object.freeze({
  density: "comfortable",
  showMessagePreviews: true,
  showOnlineIndicators: true,
  prioritizeUnread: false,
  enterToSend: true,
});

const STORAGE_KEY_PREFIX = "vine_dm_inbox_preferences";

const getCurrentVineUserId = () => {
  if (typeof window === "undefined") return 0;
  try {
    return Number(JSON.parse(window.localStorage.getItem("vine_user") || "{}")?.id || 0);
  } catch {
    return 0;
  }
};

const getStorageKey = () => {
  const userId = getCurrentVineUserId();
  return userId > 0 ? `${STORAGE_KEY_PREFIX}_${userId}` : STORAGE_KEY_PREFIX;
};

export const normalizeDmInboxPreferences = (value = {}) => ({
  density: value?.density === "compact" ? "compact" : "comfortable",
  showMessagePreviews: value?.showMessagePreviews !== false,
  showOnlineIndicators: value?.showOnlineIndicators !== false,
  prioritizeUnread: value?.prioritizeUnread === true,
  enterToSend: value?.enterToSend !== false,
});

export const readDmInboxPreferences = () => {
  if (typeof window === "undefined") return { ...DEFAULT_DM_INBOX_PREFERENCES };
  try {
    const stored = JSON.parse(window.localStorage.getItem(getStorageKey()) || "{}");
    return normalizeDmInboxPreferences(stored);
  } catch {
    return { ...DEFAULT_DM_INBOX_PREFERENCES };
  }
};

export const saveDmInboxPreferences = (preferences) => {
  const normalized = normalizeDmInboxPreferences(preferences);
  if (typeof window === "undefined") return normalized;

  try {
    window.localStorage.setItem(getStorageKey(), JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(DM_INBOX_PREFERENCES_EVENT, { detail: normalized }));
  } catch {
    // The setting still works for this render when storage is unavailable.
  }
  return normalized;
};

export const resetDmInboxPreferences = () => {
  const defaults = { ...DEFAULT_DM_INBOX_PREFERENCES };
  if (typeof window === "undefined") return defaults;

  try {
    window.localStorage.removeItem(getStorageKey());
    window.dispatchEvent(new CustomEvent(DM_INBOX_PREFERENCES_EVENT, { detail: defaults }));
  } catch {
    // Keep the in-memory defaults when storage is unavailable.
  }
  return defaults;
};

export const subscribeToDmInboxPreferences = (listener) => {
  if (typeof window === "undefined" || typeof listener !== "function") return () => {};

  const handlePreferenceChange = (event) => {
    listener(normalizeDmInboxPreferences(event?.detail || readDmInboxPreferences()));
  };
  const handleStorageChange = (event) => {
    if (event?.key && !event.key.startsWith(STORAGE_KEY_PREFIX)) return;
    listener(readDmInboxPreferences());
  };

  window.addEventListener(DM_INBOX_PREFERENCES_EVENT, handlePreferenceChange);
  window.addEventListener("storage", handleStorageChange);
  return () => {
    window.removeEventListener(DM_INBOX_PREFERENCES_EVENT, handlePreferenceChange);
    window.removeEventListener("storage", handleStorageChange);
  };
};

export const orderInboxConversations = (conversations = [], prioritizeUnread = false) => {
  if (!prioritizeUnread) return conversations;

  return conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((first, second) => {
      const pinnedDifference =
        Number(second.conversation?.is_pinned || 0) - Number(first.conversation?.is_pinned || 0);
      if (pinnedDifference) return pinnedDifference;

      const unreadDifference =
        Number(Number(second.conversation?.unread_count || 0) > 0) -
        Number(Number(first.conversation?.unread_count || 0) > 0);
      return unreadDifference || first.index - second.index;
    })
    .map(({ conversation }) => conversation);
};
