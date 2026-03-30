import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useIdleSessionPrompt from "../../../hooks/useIdleSessionPrompt";
import {
  ADMIN_SESSION_EXPIRED_EVENT,
  clearAdminSession,
  forceAdminLogout,
} from "../../../utils/adminSecurity";
import "../../../pages/AdminDashboard.css";
import "../pages/ALevelAdminTheme.css";

const STORAGE_THEME_KEY = "alevelDashboardTheme";
const STORAGE_SIDEBAR_KEY = "alevelSidebarCollapsed";
const COMPACT_VIEWPORT_WIDTH = 1180;
const ADMIN_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ADMIN_IDLE_WARNING_MS = 90 * 1000;

const NAV_ITEMS = [
  { label: "Overview", shortLabel: "OV", path: "/ark/admin/alevel" },
  { label: "Learners", shortLabel: "LR", path: "/ark/admin/alevel/learners" },
  { label: "Assignments", shortLabel: "AS", path: "/ark/admin/alevel/assign" },
  { label: "Data Center", shortLabel: "DC", path: "/ark/admin/alevel/downloads" },
  { label: "Report Hub", shortLabel: "RP", path: "/ark/admin/alevel/reports" },
];

export default function ALevelAdminShell({
  title,
  subtitle,
  children,
  contentClassName = "",
  contentStyle,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const [themeMode, setThemeMode] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_THEME_KEY) || "dark";
    } catch {
      return "dark";
    }
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_SIDEBAR_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [viewportWidth, setViewportWidth] = useState(() => {
    if (typeof window === "undefined") return COMPACT_VIEWPORT_WIDTH + 1;
    return window.innerWidth;
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleResize = () => setViewportWidth(window.innerWidth);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_THEME_KEY, themeMode);
    } catch {
      // ignore storage issues
    }
  }, [themeMode]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SIDEBAR_KEY, String(sidebarCollapsed));
    } catch {
      // ignore storage issues
    }
  }, [sidebarCollapsed]);

  const isDark = themeMode !== "light";
  const isCompactViewport = viewportWidth <= COMPACT_VIEWPORT_WIDTH;
  const isSidebarCompact = sidebarCollapsed || isCompactViewport;
  const { promptVisible, secondsRemaining, renewSession, logoutNow } = useIdleSessionPrompt({
    onTimeout: () => forceAdminLogout("/ark"),
    idleMs: ADMIN_IDLE_TIMEOUT_MS,
    warningMs: ADMIN_IDLE_WARNING_MS,
  });

  useEffect(() => {
    const handleAdminSessionExpired = () => {
      forceAdminLogout("/ark");
    };

    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, handleAdminSessionExpired);
    return () => window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, handleAdminSessionExpired);
  }, []);

  const handleLogout = () => {
    clearAdminSession();
    navigate("/ark", { replace: true });
  };

  const activePath = useMemo(() => {
    if (location.pathname.startsWith("/ark/admin/alevel/reports")) return "/ark/admin/alevel/reports";
    if (location.pathname.startsWith("/ark/admin/alevel/downloads")) return "/ark/admin/alevel/downloads";
    if (location.pathname.startsWith("/ark/admin/alevel/assign")) return "/ark/admin/alevel/assign";
    if (location.pathname.startsWith("/ark/admin/alevel/learners")) return "/ark/admin/alevel/learners";
    return "/ark/admin/alevel";
  }, [location.pathname]);

  const palette = isDark
    ? {
        sidebarBackground: "#050608",
        sidebarBorder: "rgba(255, 255, 255, 0.05)",
        titleText: "#f8fafc",
        bodyText: "#e2e8f0",
        mutedText: "#94a3b8",
        topBarBackground: "linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.76))",
        topBarBorder: "rgba(255, 255, 255, 0.06)",
        shellBackground: "radial-gradient(circle at top left, #0b1220, #020617 55%, #000000)",
        navBackground: "rgba(255, 255, 255, 0.03)",
        navHover: "rgba(56, 189, 248, 0.12)",
        navText: "#cbd5e1",
        navActiveText: "#7dd3fc",
        navActiveBorder: "rgba(56, 189, 248, 0.34)",
        accent: "#38bdf8",
        ghostBackground: "rgba(255, 255, 255, 0.04)",
        ghostBorder: "rgba(255, 255, 255, 0.08)",
      }
    : {
        sidebarBackground: "rgba(255, 255, 255, 0.96)",
        sidebarBorder: "rgba(15, 23, 42, 0.08)",
        titleText: "#0f172a",
        bodyText: "#0f172a",
        mutedText: "#475569",
        topBarBackground: "linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.88))",
        topBarBorder: "rgba(15, 23, 42, 0.08)",
        shellBackground: "radial-gradient(circle at top left, #f8fafc, #eef2ff 55%, #e2e8f0)",
        navBackground: "rgba(15, 23, 42, 0.03)",
        navHover: "rgba(14, 165, 233, 0.10)",
        navText: "#334155",
        navActiveText: "#0369a1",
        navActiveBorder: "rgba(14, 165, 233, 0.22)",
        accent: "#0284c7",
        ghostBackground: "rgba(255, 255, 255, 0.7)",
        ghostBorder: "rgba(15, 23, 42, 0.10)",
      };

  const shellVars = {
    "--alevel-sidebar-width": isSidebarCompact ? "92px" : "270px",
    "--alevel-shell-bg": palette.shellBackground,
    "--alevel-sidebar-bg": palette.sidebarBackground,
    "--alevel-sidebar-border": palette.sidebarBorder,
    "--alevel-topbar-bg": palette.topBarBackground,
    "--alevel-topbar-border": palette.topBarBorder,
    "--alevel-nav-bg": palette.navBackground,
    "--alevel-nav-hover": palette.navHover,
    "--alevel-nav-text": palette.navText,
    "--alevel-nav-active-text": palette.navActiveText,
    "--alevel-nav-active-border": palette.navActiveBorder,
    "--alevel-accent": palette.accent,
    "--alevel-shell-title": palette.titleText,
    "--alevel-shell-body": palette.bodyText,
    "--alevel-shell-muted": palette.mutedText,
    "--alevel-shell-ghost-bg": palette.ghostBackground,
    "--alevel-shell-ghost-border": palette.ghostBorder,
  };

  const content = typeof children === "function" ? children({ isDark, themeMode, sidebarCollapsed, palette }) : children;

  return (
    <div
      className={`admin-root alevel-admin-root alevel-shell-root ${isDark ? "mode-dark" : "mode-light"} ${
        isSidebarCompact ? "sidebar-collapsed" : ""
      } ${isCompactViewport ? "viewport-compact" : ""} ${
        isCompactViewport ? "sidebar-auto-compact" : ""
      }`}
      style={shellVars}
    >
      <aside className="alevel-sidebar alevel-shell-sidebar">
        <div className="alevel-shell-brand">
          <div className="alevel-shell-brand-copy">
            <div className="alevel-shell-brand-title">
              <span>ARK</span>
              {!isSidebarCompact && <span className="alevel-shell-brand-accent">ADMIN</span>}
            </div>
            {!isSidebarCompact && <p>A-Level Control Room</p>}
          </div>
          <button
            type="button"
            className="alevel-shell-collapse-btn"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            title={
              isCompactViewport
                ? "Navigation auto-compacts at this window size"
                : isSidebarCompact
                  ? "Expand navigation"
                  : "Collapse navigation"
            }
            aria-label={
              isCompactViewport
                ? "Navigation auto-compacts at this window size"
                : isSidebarCompact
                  ? "Expand navigation"
                  : "Collapse navigation"
            }
            disabled={isCompactViewport}
          >
            {isCompactViewport ? "•" : isSidebarCompact ? "→" : "←"}
          </button>
        </div>

        <nav className="alevel-shell-nav">
          {NAV_ITEMS.map((item) => {
            const isActive = activePath === item.path;
            return (
              <button
                key={item.path}
                type="button"
                className={`alevel-shell-nav-item ${isActive ? "is-active" : ""}`}
                onClick={() => navigate(item.path)}
                title={item.label}
              >
                <span className="alevel-shell-nav-badge">{isSidebarCompact ? item.shortLabel : item.label.slice(0, 2)}</span>
                {!isSidebarCompact && <span className="alevel-shell-nav-label">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="alevel-shell-sidebar-actions">
          <button
            type="button"
            className="alevel-shell-sidebar-btn"
            onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            <span>{isDark ? "Light" : "Dark"}</span>
            {!isSidebarCompact && <span>{isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}</span>}
          </button>

          <button
            type="button"
            className="alevel-shell-sidebar-btn"
            onClick={() => navigate("/ark/admin")}
            title="Go to O-Level system"
          >
            <span>OL</span>
            {!isSidebarCompact && <span>O-Level System</span>}
          </button>
        </div>
      </aside>

      <div className="alevel-shell-main">
        <header className="admin-nav alevel-shell-topbar">
          <div className="alevel-shell-topbar-copy">
            <div className="brand">
              <span className="brand-dot" />
              <span className="brand-text">SPESS</span>
              <span className="brand-tag">A-Level</span>
            </div>
            <div className="alevel-shell-page-copy">
              <h1>{title}</h1>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          </div>

          <div className="alevel-shell-topbar-actions">
            <button
              type="button"
              className="ghost-btn alevel-shell-topbar-btn"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              disabled={isCompactViewport}
            >
              {isCompactViewport ? "Nav Compact" : isSidebarCompact ? "Show Nav" : "Collapse Nav"}
            </button>
            <button
              type="button"
              className="ghost-btn alevel-shell-topbar-btn"
              onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
            >
              {isDark ? "Light Mode" : "Dark Mode"}
            </button>
            <button type="button" className="ghost-btn alevel-shell-topbar-btn" onClick={() => navigate("/ark/admin")}>
              O-Level
            </button>
            <button type="button" className="nav-logout" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        <main className={`admin-main alevel-admin-main alevel-shell-content ${contentClassName}`.trim()} style={contentStyle}>
          {content}
        </main>
      </div>

      {promptVisible && (
        <div className="modal-backdrop" onClick={logoutNow}>
          <div
            className="modal-card session-timeout-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="session-timeout-body">
              <div className="session-timeout-badge">
                <span className="session-timeout-badge-dot" />
                Secure Session Monitor
              </div>

              <h2 className="session-timeout-title">Still working in A-Level?</h2>
              <p className="session-timeout-copy">
                You have been inactive for a while. Choose <strong>Stay Signed In</strong> to renew this admin
                session, or we will sign you out automatically in <strong>{secondsRemaining}s</strong>.
              </p>

              <div className="session-timeout-meta">
                <strong>{secondsRemaining}s remaining</strong>
                <span>Automatic sign-out armed</span>
              </div>

              <div className="session-timeout-meter">
                <div
                  className="session-timeout-meter-fill"
                  style={{
                    width: `${Math.max(0, Math.min(100, (secondsRemaining / (ADMIN_IDLE_WARNING_MS / 1000)) * 100))}%`,
                  }}
                />
              </div>

              <p className="session-timeout-note">
                <strong>Why this matters:</strong> A-Level records stay protected when an unattended session is
                closed cleanly. Renew only if you are still actively working.
              </p>

              <div className="session-timeout-actions">
                <button type="button" className="ghost-btn" onClick={logoutNow}>
                  Log Out
                </button>
                <button type="button" className="primary-btn" onClick={renewSession}>
                  Stay Signed In
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
