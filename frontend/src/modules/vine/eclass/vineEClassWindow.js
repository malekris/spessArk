export const getVineEClassWindowPath = (communityId, options = {}) => {
  const id = Number(communityId);
  if (!id) return "/vine/communities";
  const params = new URLSearchParams();
  if (options.launching) params.set("launching", "1");
  if (options.handoff) params.set("handoff", "1");
  const query = params.toString();
  return `/vine/eclass/${id}${query ? `?${query}` : ""}`;
};

export const openVineEClassWindow = (communityId, options = {}) => {
  if (typeof window === "undefined") return null;
  const id = Number(communityId);
  if (!id) return null;
  const classWindow = window.open(
    getVineEClassWindowPath(id, options),
    `vine-eclass-${id}`
  );
  if (!classWindow) return null;
  try {
    classWindow.opener = null;
    classWindow.focus();
  } catch {
    // The new tab is still usable if the browser restricts window access.
  }
  return classWindow;
};
