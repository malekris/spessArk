const POST_SOURCE_LABELS = {
  iphone: "iPhone",
  ipad: "iPad",
  android: "Android",
  windows: "Windows",
  mac: "Mac",
  linux: "Linux",
  mobile: "Mobile",
  web: "Web",
};

export const detectVinePostSource = (rawValue) => {
  const lower = String(rawValue || "").trim().toLowerCase();
  if (!lower) return "";
  if (lower.includes("iphone")) return POST_SOURCE_LABELS.iphone;
  if (lower.includes("ipad")) return POST_SOURCE_LABELS.ipad;
  if (lower.includes("android")) return POST_SOURCE_LABELS.android;
  if (lower.includes("windows")) return POST_SOURCE_LABELS.windows;
  if (lower.includes("mac os") || lower.includes("macintosh") || lower === "mac") {
    return POST_SOURCE_LABELS.mac;
  }
  if (lower.includes("linux")) return POST_SOURCE_LABELS.linux;
  if (lower.includes("mobile")) return POST_SOURCE_LABELS.mobile;
  if (lower === "web") return POST_SOURCE_LABELS.web;
  return POST_SOURCE_LABELS.web;
};

export const getCurrentVinePostSource = () => {
  if (typeof navigator === "undefined") return "";
  return detectVinePostSource(navigator.userAgent || navigator.platform || "");
};
