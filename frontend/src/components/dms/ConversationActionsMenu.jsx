import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function ConversationActionsMenu({ label, isPinned, onPin, onDelete }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const closeAndFocus = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    const positionMenu = () => {
      const rect = trigger.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const below = rect.bottom + 6;
      const top = below + height <= window.innerHeight - 8 ? below : rect.top - height - 6;
      menu.style.left = `${left}px`;
      menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
    };
    const dismissOutside = (event) => {
      if (!menu.contains(event.target) && !trigger.contains(event.target)) setOpen(false);
    };
    const dismissEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.focus({ preventScroll: true });
    };

    // The portal escapes clipping and transformed ancestors in the inbox rows.
    positionMenu();
    menu.querySelector("button")?.focus({ preventScroll: true });
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [open]);

  const handleMenuKeyDown = (event) => {
    if (event.key === "Tab") {
      closeAndFocus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...menuRef.current.querySelectorAll("[role='menuitem']")];
    const current = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  };

  return (
    <div className="dm-row-menu" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="dm-row-menu-trigger"
        ref={triggerRef}
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Conversation actions"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && createPortal(
        <div className="dm-row-menu-popover" ref={menuRef} id={menuId} role="menu" aria-label={`Actions for ${label}`} onKeyDown={handleMenuKeyDown}>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => { closeAndFocus(); onPin(); }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path d="m9 4 6 0-.5 4 2.5 2.5v1H7v-1L9.5 8 9 4Zm3 7.5V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {isPinned ? "Unpin" : "Pin"}
          </button>
          <button className="danger" type="button" role="menuitem" tabIndex={-1} onClick={() => { closeAndFocus(); onDelete(); }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path d="M8 8v10m4-10v10m4-10v10M5 5h14M9 5l1-2h4l1 2m2 0-1 16H8L7 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
