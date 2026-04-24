import { useState } from "react";
import SplashScreen from "../pages/SplashScreen";

export default function ArkLayout({ children }) {
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  return children;
}
