import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import useIdleSessionPrompt from "../../../hooks/useIdleSessionPrompt";
import { adminFetch } from "../../../lib/api";
import {
  ADMIN_SESSION_EXPIRED_EVENT,
  forceAdminLogout,
} from "../../../utils/adminSecurity";
import "../../../pages/AdminDashboard.css";
import "../pages/TimetableAdminTheme.css";

const STORAGE_THEME_KEY = "timetableDashboardTheme";
const ADMIN_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ADMIN_IDLE_WARNING_MS = 90 * 1000;

const TIMETABLE_MODULES = [
  {
    code: "overview",
    shortCode: "OV",
    label: "Overview",
    description: "Readiness and recent drafts",
    state: "Live",
  },
  {
    code: "week",
    shortCode: "WK",
    label: "School Week",
    description: "Days, periods, breaks and assemblies",
    state: "Configured",
  },
  {
    code: "constraints",
    shortCode: "RL",
    label: "Constraints",
    description: "Teacher availability and lesson rules",
    state: "Editable",
  },
  {
    code: "generate",
    shortCode: "GN",
    label: "Generate",
    description: "Draft timetable production",
    state: "Ready",
  },
  {
    code: "timetables",
    shortCode: "TB",
    label: "Timetables",
    description: "Review, export and publish",
    state: "Views",
  },
];

export default function TimetableAdminShell({
  title,
  subtitle,
  activeModule = "overview",
  onModuleChange,
  children,
}) {
  const navigate = useNavigate();
  const [themeMode, setThemeMode] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_THEME_KEY) || "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    const token = localStorage.getItem("adminToken");
    if (!token) {
      navigate("/ark", { replace: true });
      return;
    }

    adminFetch("/api/admin/me").catch(() => {
      forceAdminLogout("/ark", { reason: "session-expired" });
    });
  }, [navigate]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_THEME_KEY, themeMode);
    } catch {
      // Theme storage is optional.
    }
  }, [themeMode]);

  useEffect(() => {
    document.title = `${String(title || "Timetable").trim()} | Timetable | SPESS ARK`;
  }, [title]);

  useEffect(() => {
    const handleAdminSessionExpired = (event) => {
      const shouldBroadcast = event?.detail?.source !== "storage-logout-signal";
      forceAdminLogout("/ark", {
        broadcast: shouldBroadcast,
        reason: "session-expired",
      });
    };

    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, handleAdminSessionExpired);
    return () => window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, handleAdminSessionExpired);
  }, []);

  const isDark = themeMode !== "light";
  const { promptVisible, secondsRemaining, renewSession, logoutNow } = useIdleSessionPrompt({
    onTimeout: () => forceAdminLogout("/ark"),
    idleMs: ADMIN_IDLE_TIMEOUT_MS,
    warningMs: ADMIN_IDLE_WARNING_MS,
  });

  const shellVars = isDark
    ? {
        "--tt-shell-bg": "#101314",
        "--tt-topbar-bg": "rgba(16, 19, 20, 0.96)",
        "--tt-surface": "#191d1e",
        "--tt-surface-strong": "#202526",
        "--tt-border": "rgba(226, 232, 240, 0.12)",
        "--tt-title": "#f8fafc",
        "--tt-body": "#d7dee2",
        "--tt-muted": "#98a5aa",
        "--tt-accent": "#22d3ee",
        "--tt-success": "#34d399",
        "--tt-warning": "#fbbf24",
      }
    : {
        "--tt-shell-bg": "#f3f5f4",
        "--tt-topbar-bg": "rgba(255, 255, 255, 0.96)",
        "--tt-surface": "#ffffff",
        "--tt-surface-strong": "#edf2f0",
        "--tt-border": "rgba(15, 23, 42, 0.14)",
        "--tt-title": "#111827",
        "--tt-body": "#263238",
        "--tt-muted": "#5f6d72",
        "--tt-accent": "#087f8c",
        "--tt-success": "#047857",
        "--tt-warning": "#a16207",
      };

  const content = typeof children === "function" ? children({ isDark, themeMode }) : children;

  return (
    <div
      className={`admin-root timetable-admin-root timetable-shell-root ${
        isDark ? "mode-dark" : "mode-light"
      }`}
      style={shellVars}
    >
      <header className="timetable-shell-topbar">
        <div className="timetable-shell-topbar-copy">
          <div className="brand">
            <span className="brand-dot" />
            <span className="brand-text">SPESS</span>
            <span className="brand-tag">Timetable</span>
          </div>
          <div className="timetable-shell-page-copy">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>

        <div className="timetable-shell-topbar-actions">
          <button
            type="button"
            className="ghost-btn timetable-shell-command"
            onClick={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
          >
            {isDark ? "Light Mode" : "Dark Mode"}
          </button>
          <button
            type="button"
            className="ghost-btn timetable-shell-command"
            onClick={() => navigate("/ark/admin/alevel")}
          >
            A-Level
          </button>
          <button
            type="button"
            className="ghost-btn timetable-shell-command"
            onClick={() => navigate("/ark/admin")}
          >
            Admin Dashboard
          </button>
          <button
            type="button"
            className="nav-logout"
            onClick={() => forceAdminLogout("/ark", { reason: "manual-logout" })}
          >
            Logout
          </button>
        </div>
      </header>

      <div className="timetable-module-nav-shell">
        <nav className="timetable-module-nav" aria-label="Timetable modules">
          {TIMETABLE_MODULES.map((item) => (
            <button
              key={item.code}
              type="button"
              className={`timetable-module-card${activeModule === item.code ? " is-active" : ""}`}
              onClick={() => onModuleChange?.(item.code)}
              aria-current={activeModule === item.code ? "page" : undefined}
            >
              <span className="timetable-module-card-head">
                <span className="timetable-module-code">{item.shortCode}</span>
                <span className="timetable-module-state">{item.state}</span>
              </span>
              <strong>{item.label}</strong>
              <span className="timetable-module-copy">{item.description}</span>
            </button>
          ))}
        </nav>
      </div>

      <main className="admin-main timetable-shell-content">{content}</main>

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
              <h2 className="session-timeout-title">Still working in Timetable?</h2>
              <p className="session-timeout-copy">
                Choose <strong>Stay Signed In</strong> to renew this admin session, or automatic
                sign-out will occur in <strong>{secondsRemaining}s</strong>.
              </p>
              <div className="session-timeout-meta">
                <strong>{secondsRemaining}s remaining</strong>
                <span>Automatic sign-out armed</span>
              </div>
              <div className="session-timeout-meter">
                <div
                  className="session-timeout-meter-fill"
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(100, (secondsRemaining / (ADMIN_IDLE_WARNING_MS / 1000)) * 100)
                    )}%`,
                  }}
                />
              </div>
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
