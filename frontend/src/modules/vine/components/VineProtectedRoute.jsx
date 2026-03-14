import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { clearVineAuth, getVineToken, getVineUser, isVineTokenExpired } from "../utils/vineAuth";
import { socket } from "../../../socket";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineProtectedRoute() {
  const location = useLocation();
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let cancelled = false;
    let controller = null;

    const validateSession = async () => {
      const token = getVineToken();
      const storedUser = getVineUser();

      if (!token || !storedUser?.id || isVineTokenExpired(token)) {
        clearVineAuth();
        socket.disconnect();
        if (!cancelled) setStatus("denied");
        return;
      }

      controller?.abort();
      controller = new AbortController();

      try {
        const res = await fetch(`${API}/api/vine/auth/session`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (!res.ok) {
          clearVineAuth();
          socket.disconnect();
          if (!cancelled) setStatus("denied");
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (data?.user) {
          localStorage.setItem("vine_user", JSON.stringify(data.user));
        }
        if (!cancelled) setStatus("allowed");
      } catch (err) {
        if (controller?.signal?.aborted) return;
        clearVineAuth();
        socket.disconnect();
        if (!cancelled) setStatus("denied");
      }
    };

    validateSession();

    const handleVisibilityCheck = () => {
      if (document.visibilityState === "hidden") return;
      validateSession();
    };

    window.addEventListener("focus", handleVisibilityCheck);
    document.addEventListener("visibilitychange", handleVisibilityCheck);

    return () => {
      cancelled = true;
      controller?.abort();
      window.removeEventListener("focus", handleVisibilityCheck);
      document.removeEventListener("visibilitychange", handleVisibilityCheck);
    };
  }, [location.pathname, location.search, location.hash]);

  if (status === "checking") {
    return <div className="vine-auth-checking">Checking session...</div>;
  }

  if (status !== "allowed") {
    return (
      <Navigate
        to="/vine/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  return <Outlet />;
}
