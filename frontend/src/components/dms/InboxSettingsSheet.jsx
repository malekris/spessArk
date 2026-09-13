import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./InboxSettingsSheet.css";

const SettingIcon = ({ type }) => {
  if (type === "preview") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3.5 12s3.1-5.5 8.5-5.5 8.5 5.5 8.5 5.5-3.1 5.5-8.5 5.5S3.5 12 3.5 12Z" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (type === "presence") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="10" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3.8 19c.5-3.4 2.6-5.1 6.2-5.1 1.8 0 3.2.4 4.2 1.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="17.7" cy="17.4" r="2.8" fill="currentColor" />
      </svg>
    );
  }
  if (type === "unread") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="m6.5 8 5.5 4 5.5-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18.5" cy="5.5" r="3.1" fill="currentColor" stroke="var(--dm-settings-surface, #fff)" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 7.5h8M8 11.5h8M8 15.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
};

const PreferenceSwitch = ({ checked, label, onChange }) => (
  <button
    type="button"
    className={`dm-inbox-switch ${checked ? "on" : ""}`}
    onClick={() => onChange(!checked)}
    role="switch"
    aria-checked={checked}
    aria-label={label}
  >
    <span />
  </button>
);

const PreferenceRow = ({ icon, title, description, checked, onChange }) => (
  <div className="dm-inbox-settings-row">
    <span className="dm-inbox-settings-row-icon"><SettingIcon type={icon} /></span>
    <span className="dm-inbox-settings-row-copy">
      <strong>{title}</strong>
      <small>{description}</small>
    </span>
    <PreferenceSwitch checked={checked} label={title} onChange={onChange} />
  </div>
);

export default function InboxSettingsSheet({ open, preferences, onChange, onReset, onClose }) {
  const closeButtonRef = useRef(null);
  const sheetRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus({ preventScroll: true }), 0);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(sheetRef.current?.querySelectorAll("button:not([disabled])") || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      previousFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="dm-inbox-settings-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={sheetRef}
        className="dm-inbox-settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-inbox-settings-title"
        aria-describedby="dm-inbox-settings-description"
      >
        <div className="dm-inbox-settings-handle" aria-hidden="true" />
        <header className="dm-inbox-settings-header">
          <div className="dm-inbox-settings-heading">
            <span className="dm-inbox-settings-heading-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M9.6 3.5h4.8l.7 2.1 2 .8 2-1 2.4 4.1-1.7 1.5.2 2.2 1.5 1.7-2.4 4.1-2.1-1-2 .8-.7 2.2H9.6l-.7-2.2-2-.8-2.1 1-2.4-4.1 1.6-1.7.1-2.2-1.7-1.5 2.4-4.1 2 1 2.1-.8.7-2.1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
              </svg>
            </span>
            <div>
              <span className="dm-inbox-settings-kicker">Messages</span>
              <h2 id="dm-inbox-settings-title">DM settings</h2>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" className="dm-inbox-settings-close" onClick={onClose} aria-label="Close DM settings">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <p id="dm-inbox-settings-description" className="dm-inbox-settings-intro">
          Shape your inbox without changing how it looks for anyone else. These preferences stay with your Vine account on this device.
        </p>

        <div className="dm-inbox-settings-content">
          <section className="dm-inbox-settings-card" aria-labelledby="dm-inbox-layout-title">
            <div className="dm-inbox-settings-section-heading">
              <span>Appearance</span>
              <strong id="dm-inbox-layout-title">Inbox spacing</strong>
            </div>
            <div className="dm-inbox-density-options" role="radiogroup" aria-label="Inbox spacing">
              {[
                { value: "comfortable", label: "Comfortable", detail: "More breathing room" },
                { value: "compact", label: "Compact", detail: "See more chats" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={preferences.density === option.value ? "active" : ""}
                  onClick={() => onChange({ density: option.value })}
                  role="radio"
                  aria-checked={preferences.density === option.value}
                >
                  <span className="dm-inbox-density-lines" aria-hidden="true"><i /><i /><i /></span>
                  <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                </button>
              ))}
            </div>
          </section>

          <section className="dm-inbox-settings-card dm-inbox-settings-list" aria-label="Inbox display">
            <div className="dm-inbox-settings-section-heading">
              <span>Privacy & presence</span>
              <strong>What appears in your inbox</strong>
            </div>
            <PreferenceRow
              icon="preview"
              title="Message previews"
              description="Show the latest message beneath each name."
              checked={preferences.showMessagePreviews}
              onChange={(value) => onChange({ showMessagePreviews: value })}
            />
            <PreferenceRow
              icon="presence"
              title="Online indicators"
              description="Show when a person is currently active."
              checked={preferences.showOnlineIndicators}
              onChange={(value) => onChange({ showOnlineIndicators: value })}
            />
          </section>

          <section className="dm-inbox-settings-card dm-inbox-settings-list" aria-label="Inbox behavior">
            <div className="dm-inbox-settings-section-heading">
              <span>Behavior</span>
              <strong>Make messaging feel faster</strong>
            </div>
            <PreferenceRow
              icon="unread"
              title="Unread chats first"
              description="Keep pinned chats on top, then surface unread chats."
              checked={preferences.prioritizeUnread}
              onChange={(value) => onChange({ prioritizeUnread: value })}
            />
            <PreferenceRow
              icon="composer"
              title="Enter to send"
              description="Turn off to use Enter for a new line and Ctrl/⌘ + Enter to send."
              checked={preferences.enterToSend}
              onChange={(value) => onChange({ enterToSend: value })}
            />
          </section>
        </div>

        <footer className="dm-inbox-settings-footer">
          <button type="button" onClick={onReset}>Restore defaults</button>
          <span>Changes save automatically</span>
        </footer>
      </aside>
    </div>,
    document.body
  );
}
