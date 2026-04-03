import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./MessageBubbles.css"; // Import the new styles

const REACTION_SET = ["👍", "❤️", "😂", "🔥", "😮", "😢"];

const getMessageDisappearingLabel = (mode) => {
  if (mode === "1h") return "Disappears in 1 hour";
  if (mode === "24h") return "Disappears in 24 hours";
  return "Disappears after read";
};

function MessageBubble({ message, onReply, onReact, onDelete }) {
  const currentUser = JSON.parse(localStorage.getItem("vine_user"));
  const myId = currentUser?.id;
  const isMine = Number(message.sender_id) === Number(myId);
  const reactions = message?.reactions || {};
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const actionButtonRef = useRef(null);
  const menuRef = useRef(null);
  const pickerRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });

  const updatePickerPosition = () => {
    const trigger = actionButtonRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const pickerWidth = pickerRef.current?.offsetWidth || 300;
    const pickerHeight = pickerRef.current?.offsetHeight || 54;
    const left = Math.min(
      window.innerWidth - pickerWidth - 8,
      Math.max(8, rect.left + rect.width / 2 - pickerWidth / 2)
    );
    let top = rect.top - pickerHeight - 10;
    if (top < 8) top = rect.bottom + 10;
    setPickerPosition({ top, left });
  };

  const updateMenuPosition = () => {
    const trigger = actionButtonRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menuRef.current?.offsetWidth || 170;
    const menuHeight = menuRef.current?.offsetHeight || 140;
    const left = Math.min(
      window.innerWidth - menuWidth - 8,
      Math.max(8, rect.right - menuWidth)
    );
    let top = rect.bottom + 8;
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuHeight - 8);
    }
    setMenuPosition({ top, left });
  };

  useEffect(() => {
    const handleOutside = (event) => {
      if (
        !actionButtonRef.current?.contains(event.target) &&
        !pickerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setPickerOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  useEffect(() => {
    if (!pickerOpen && !menuOpen) return;
    const raf = requestAnimationFrame(() => {
      if (menuOpen) updateMenuPosition();
      if (pickerOpen) updatePickerPosition();
    });
    const handleReposition = () => updatePickerPosition();
    const handleMenuReposition = () => updateMenuPosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleMenuReposition);
    window.addEventListener("scroll", handleMenuReposition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleMenuReposition);
      window.removeEventListener("scroll", handleMenuReposition, true);
    };
  }, [menuOpen, pickerOpen]);

  const selectReaction = (emoji) => {
    onReact?.(message, message.viewer_reaction === emoji ? "" : emoji);
    setPickerOpen(false);
  };

  const openReactionPicker = () => {
    setMenuOpen(false);
    setPickerOpen(true);
  };

  return (
    <div className={`msg-row ${isMine ? "mine" : "theirs"}`}>
      <div className="msg-content-wrapper">
        {message.reply_to_message && (
          <div className="dm-reply-preview">
            <strong>{message.reply_to_message.display_name || message.reply_to_message.username}</strong>
            <span>{message.reply_to_message.content}</span>
          </div>
        )}
        <div className="msg-shell">
          {isMine && (
            <button
              type="button"
              className="dm-message-menu-trigger"
              ref={actionButtonRef}
              aria-label="Message options"
              title="Message options"
              onClick={() => {
                setPickerOpen(false);
                setMenuOpen((prev) => !prev);
              }}
            >
              <span />
              <span />
              <span />
            </button>
          )}

          <div className="msg-bubble">
            {message.media_url && message.media_type === "image" && (
              <img className="dm-media-img" src={message.media_url} alt="sent media" />
            )}
            {message.media_url && message.media_type === "voice" && (
              <audio className="dm-media-audio" controls src={message.media_url} />
            )}
            {message.content}
          </div>

          {!isMine && (
            <button
              type="button"
              className="dm-message-menu-trigger"
              ref={actionButtonRef}
              aria-label="Message options"
              title="Message options"
              onClick={() => {
                setPickerOpen(false);
                setMenuOpen((prev) => !prev);
              }}
            >
              <span />
              <span />
              <span />
            </button>
          )}
        </div>

        {menuOpen &&
          createPortal(
            <div
              ref={menuRef}
              className="dm-message-menu"
              role="menu"
              aria-label="Message options"
              style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
            >
              <button
                type="button"
                className="dm-message-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onReply?.(message);
                }}
              >
                Reply
              </button>
              <button
                type="button"
                className="dm-message-menu-item"
                onClick={openReactionPicker}
              >
                Reactions
              </button>
              {isMine && !String(message.id || "").startsWith("temp-") && (
                <button
                  type="button"
                  className="dm-message-menu-item danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete?.(message);
                  }}
                >
                  Delete
                </button>
              )}
            </div>,
            document.body
          )}

        {pickerOpen &&
          createPortal(
            <div
              ref={pickerRef}
              className="dm-reaction-picker dm-reaction-picker-floating"
              role="menu"
              aria-label="Choose a reaction"
              style={{ top: `${pickerPosition.top}px`, left: `${pickerPosition.left}px` }}
            >
              {REACTION_SET.map((emoji) => (
                <button
                  key={`${message.id}-${emoji}`}
                  type="button"
                  className={message.viewer_reaction === emoji ? "active" : ""}
                  onClick={() => selectReaction(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>,
            document.body
          )}

        {Object.keys(reactions).length > 0 && (
          <div className="dm-reactions-row">
            {Object.entries(reactions).map(([k, v]) => (
              <span key={`${message.id}-r-${k}`}>{k} {v}</span>
            ))}
          </div>
        )}

        {Number(message.is_disappearing) === 1 && (
          <div className="dm-disappearing-label">
            {getMessageDisappearingLabel(message.disappear_mode)}
          </div>
        )}

        {isMine && String(message.id || "").startsWith("temp-") === false && (
          <div className="msg-seen">
            {Number(message.is_read) === 1 ? "Seen" : "Delivered"}
          </div>
        )}
      </div>
    </div>
  );
}

const areMessageBubblePropsEqual = (prevProps, nextProps) => prevProps.message === nextProps.message;

export default memo(MessageBubble, areMessageBubblePropsEqual);
