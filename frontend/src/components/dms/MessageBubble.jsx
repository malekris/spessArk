import { memo, useEffect, useMemo, useRef, useState } from "react";
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
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const actionButtonRef = useRef(null);
  const menuRef = useRef(null);
  const pickerRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const mediaItems = useMemo(() => {
    if (Array.isArray(message?.media_items) && message.media_items.length) {
      return message.media_items
        .filter((item) => item?.media_url && item?.media_type)
        .map((item) => ({
          media_url: item.media_url,
          media_type: item.media_type,
        }));
    }
    if (message?.media_url && message?.media_type) {
      return [{ media_url: message.media_url, media_type: message.media_type }];
    }
    return [];
  }, [message]);
  const imageItems = mediaItems.filter((item) => item.media_type === "image");
  const primaryVideo = mediaItems.find((item) => item.media_type === "video");
  const primaryVoice = mediaItems.find((item) => item.media_type === "voice");
  const hasAutoMediaLabel =
    mediaItems.length > 0 &&
    (/^\d+\sphotos$/i.test(String(message?.content || "").trim()) ||
      ["attachment", "video", "voice note"].includes(String(message?.content || "").trim().toLowerCase()));

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

  const openViewer = (index = 0) => {
    setViewerIndex(index);
    setViewerOpen(true);
  };

  const downloadCurrentImage = async () => {
    const current = imageItems[viewerIndex];
    if (!current?.media_url) return;
    try {
      const response = await fetch(current.media_url, { cache: "no-store" });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `vine-dm-photo-${viewerIndex + 1}.jpg`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1200);
    } catch {
      window.open(current.media_url, "_blank", "noopener,noreferrer");
    }
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
            {imageItems.length > 1 && (
              <div className={`dm-media-grid dm-media-grid-${Math.min(imageItems.length, 4)}`}>
                {imageItems.slice(0, 4).map((item, index) => (
                  <button
                    key={`${message.id}-img-${index}`}
                    type="button"
                    className="dm-media-grid-item"
                    onClick={() => openViewer(index)}
                  >
                    <img className="dm-media-grid-img" src={item.media_url} alt={`shared photo ${index + 1}`} />
                    {index === 3 && imageItems.length > 4 ? (
                      <span className="dm-media-grid-more">+{imageItems.length - 4}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
            {imageItems.length === 1 && (
              <button type="button" className="dm-media-single-btn" onClick={() => openViewer(0)}>
                <img className="dm-media-img" src={imageItems[0].media_url} alt="sent media" />
              </button>
            )}
            {primaryVideo && (
              <video className="dm-media-video" controls playsInline preload="metadata" src={primaryVideo.media_url} />
            )}
            {primaryVoice && (
              <audio className="dm-media-audio" controls src={primaryVoice.media_url} />
            )}
            {!hasAutoMediaLabel ? message.content : null}
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

        {viewerOpen && imageItems.length > 0 &&
          createPortal(
            <div className="dm-media-viewer" onClick={() => setViewerOpen(false)}>
              <button
                type="button"
                className="dm-media-viewer-close"
                onClick={(event) => {
                  event.stopPropagation();
                  setViewerOpen(false);
                }}
              >
                ✕
              </button>
              <button
                type="button"
                className="dm-media-viewer-save"
                onClick={(event) => {
                  event.stopPropagation();
                  downloadCurrentImage();
                }}
              >
                Save to device
              </button>
              {imageItems.length > 1 && (
                <button
                  type="button"
                  className="dm-media-viewer-nav prev"
                  onClick={(event) => {
                    event.stopPropagation();
                    setViewerIndex((prev) => (prev - 1 + imageItems.length) % imageItems.length);
                  }}
                >
                  ‹
                </button>
              )}
              <div className="dm-media-viewer-stage" onClick={(event) => event.stopPropagation()}>
                <img
                  src={imageItems[viewerIndex]?.media_url}
                  alt={`shared photo ${viewerIndex + 1}`}
                  className="dm-media-viewer-img"
                />
                {imageItems.length > 1 ? (
                  <div className="dm-media-viewer-count">
                    {viewerIndex + 1} / {imageItems.length}
                  </div>
                ) : null}
              </div>
              {imageItems.length > 1 && (
                <button
                  type="button"
                  className="dm-media-viewer-nav next"
                  onClick={(event) => {
                    event.stopPropagation();
                    setViewerIndex((prev) => (prev + 1) % imageItems.length);
                  }}
                >
                  ›
                </button>
              )}
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
