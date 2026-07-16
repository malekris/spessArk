export const MOBILE_PERSISTENT_SESSION_MODE = "mobile_persistent";
export const BROWSER_SESSION_MODE = "browser_session";

export const isMobileSessionDevice = () => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  if (navigator.userAgentData?.mobile === true) return true;

  const userAgent = String(navigator.userAgent || "");
  if (/Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(userAgent)) {
    return true;
  }

  const hasTouch = Number(navigator.maxTouchPoints || 0) > 0;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches === true;
  const screenWidth = Number(window.screen?.width || window.innerWidth || 0);
  const screenHeight = Number(window.screen?.height || window.innerHeight || 0);
  const shortSide = Math.min(screenWidth || Infinity, screenHeight || Infinity);

  return hasTouch && coarsePointer && Number.isFinite(shortSide) && shortSide <= 1024;
};

export const getRequestedSessionMode = () =>
  isMobileSessionDevice() ? MOBILE_PERSISTENT_SESSION_MODE : BROWSER_SESSION_MODE;
