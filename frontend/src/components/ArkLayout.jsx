import { useState } from "react";
import { useLocation } from "react-router-dom";
import SplashScreen from "../pages/SplashScreen";
import {
  NEW_ACCOUNT_SPLASH_KEY,
  NEW_ACCOUNT_SPLASH_MS,
  NORMAL_SPLASH_MS,
} from "../utils/arkSplash";

const ARK_AUTH_PATHS = new Set([
  "/ark",
  "/ark/teacher-login",
  "/ark/teacher-signup",
  "/ark/teacher-forgot",
  "/ark/boarding-login",
]);

export default function ArkLayout({ children }) {
  const location = useLocation();
  const [splashDurationMs] = useState(() => {
    const isAuthPath = ARK_AUTH_PATHS.has(location.pathname);
    const shouldUseNewAccountSplash =
      !isAuthPath && sessionStorage.getItem(NEW_ACCOUNT_SPLASH_KEY) === "1";

    if (shouldUseNewAccountSplash) {
      sessionStorage.removeItem(NEW_ACCOUNT_SPLASH_KEY);
      return NEW_ACCOUNT_SPLASH_MS;
    }

    return NORMAL_SPLASH_MS;
  });
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return <SplashScreen durationMs={splashDurationMs} onFinish={() => setShowSplash(false)} />;
  }

  return children;
}
