import { useEffect, useRef } from "react";
import AccountsProfileSettings from "./AccountsProfileSettings";

export default function AccountsSettingsDrawer({
  isBursar,
  onClose,
  onProfileChange,
  onThemeChange,
  theme,
  user,
}) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="accounts-settings-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="accounts-settings-drawer" role="dialog" aria-modal="true" aria-labelledby="accounts-drawer-title">
        <header className="accounts-settings-drawer-header">
          <div><span>Workspace</span><h2 id="accounts-drawer-title">Settings</h2></div>
          <button ref={closeButtonRef} type="button" aria-label="Close settings" title="Close settings" onClick={onClose}>×</button>
        </header>

        <section className="accounts-appearance-settings" aria-labelledby="accounts-appearance-title">
          <div>
            <span>Appearance</span>
            <h3 id="accounts-appearance-title">Dashboard theme</h3>
            <p>Choose the workspace appearance for this device.</p>
          </div>
          <div className="accounts-theme-toggle" role="group" aria-label="Dashboard theme">
            <button type="button" className={theme === "light" ? "is-active" : ""} aria-pressed={theme === "light"} onClick={() => onThemeChange("light")}>
              <i className="accounts-theme-swatch is-light" aria-hidden="true" />
              Light
            </button>
            <button type="button" className={theme === "dark" ? "is-active" : ""} aria-pressed={theme === "dark"} onClick={() => onThemeChange("dark")}>
              <i className="accounts-theme-swatch is-dark" aria-hidden="true" />
              Dark
            </button>
          </div>
        </section>

        {isBursar ? <AccountsProfileSettings user={user} onProfileChange={onProfileChange} /> : (
          <div className="accounts-owner-settings-note">
            Owner credentials are managed through the secured backend environment.
          </div>
        )}
      </aside>
    </div>
  );
}
