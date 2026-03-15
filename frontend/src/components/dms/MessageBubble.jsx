import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./MessageBubbles.css"; // Import the new styles

const REACTION_SET = ["👍", "❤️", "😂", "🔥", "😮", "😢"];
const LONG_PRESS_MS = 360;

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const reactionControlRef = useRef(null);
  const pickerRef = useRef(null);
  const holdTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });

  const updatePickerPosition = () => {
    const trigger = reactionControlRef.current;
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

  useEffect(() => {
    const handleOutside = (event) => {
      if (
        !reactionControlRef.current?.contains(event.target) &&
        !pickerRef.current?.contains(event.target)
      ) {
        setPickerOpen(false);
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
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const raf = requestAnimationFrame(updatePickerPosition);
    const handleReposition = () => updatePickerPosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [pickerOpen]);

  const beginLongPress = () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    longPressTriggeredRef.current = false;
    holdTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setPickerOpen(true);
    }, LONG_PRESS_MS);
  };

  const endLongPress = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handleReactionTriggerClick = () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    const nextReaction = message.viewer_reaction ? "" : "👍";
    onReact?.(message, nextReaction);
    setPickerOpen(false);
  };

  const selectReaction = (emoji) => {
    onReact?.(message, message.viewer_reaction === emoji ? "" : emoji);
    setPickerOpen(false);
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
        <div className="msg-bubble">
          {message.media_url && message.media_type === "image" && (
            <img className="dm-media-img" src={message.media_url} alt="sent media" />
          )}
          {message.media_url && message.media_type === "voice" && (
            <audio className="dm-media-audio" controls src={message.media_url} />
          )}
          {message.content}
        </div>

        <div className="dm-message-actions">
          <button type="button" onClick={() => onReply?.(message)}>↩️ Reply</button>
          {isMine && !String(message.id || "").startsWith("temp-") && (
            <button
              type="button"
              className="delete-icon"
              onClick={() => onDelete?.(message)}
              aria-label="Delete message"
              title="Delete message"
            >
              🗑️
            </button>
          )}
          <div className="dm-reaction-control" ref={reactionControlRef}>
            <button
              type="button"
              className={`dm-react-trigger ${message.viewer_reaction ? "active" : ""}`}
              aria-label="React to message"
              title="Tap for thumbs up, hold for more reactions"
              onMouseDown={beginLongPress}
              onMouseUp={endLongPress}
              onMouseLeave={endLongPress}
              onTouchStart={beginLongPress}
              onTouchEnd={endLongPress}
              onTouchCancel={endLongPress}
              onContextMenu={(e) => {
                e.preventDefault();
                endLongPress();
                setPickerOpen(true);
              }}
              onClick={handleReactionTriggerClick}
            >
              {message.viewer_reaction || "🙂"}
            </button>

          </div>
        </div>

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
