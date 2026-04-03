import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./ConversationList.css";
import { socket } from "../../socket";
import useWindowedList from "../../hooks/useWindowedList";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

const formatConversationTime = (dateString) => {
  if (!dateString) return "";
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return "";

  const now = new Date();
  const sameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();

  if (sameDay) {
    return parsed.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const sameYear = parsed.getFullYear() === now.getFullYear();
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatConversationTimeTitle = (dateString) => {
  if (!dateString) return "";
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export default function ConversationList() {
  /* ---------------------------
     STATE & GLOBALS
  ---------------------------- */
  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState("");
  const searchRef = useRef("");
  const listRef = useRef(null);
  const activeRequestRef = useRef(null);
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");
  const {
    visibleItems: visibleConversations,
    padTop,
    padBottom,
  } = useWindowedList(conversations, {
    containerRef: listRef,
    estimatedItemHeight: 112,
    overscan: 5,
    enabled: conversations.length > 24,
  });
  const unreadMessages = conversations.reduce((sum, item) => sum + Number(item?.unread_count || 0), 0);
  const unreadChats = conversations.filter((item) => Number(item?.unread_count || 0) > 0).length;
  const pinnedChats = conversations.filter((item) => Number(item?.is_pinned) === 1).length;

  /* ---------------------------
     FETCH CONVERSATIONS
  ---------------------------- */
  const loadConversations = async (query = "") => {
    try {
      if (activeRequestRef.current) {
        activeRequestRef.current.abort();
      }
      const controller = new AbortController();
      activeRequestRef.current = controller;
      const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const res = await fetch(`${API}/api/dms/conversations${qs}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });

      const data = await res.json();
      if (controller.signal.aborted) return;
      setConversations(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error("Failed to load conversations", err);
    }
  };

  const togglePinConversation = async (id, pinned) => {
    try {
      await fetch(`${API}/api/dms/conversations/${id}/pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pinned }),
      });
      loadConversations();
    } catch (err) {
      console.error("Pin failed", err);
    }
  };

  /* ---------------------------
     DELETE CONVERSATION
  ---------------------------- */
  const deleteConversation = async (id) => {
    try {
      await fetch(`${API}/api/dms/conversations/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      loadConversations(); // refresh inbox instantly
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  /* ---------------------------
     INITIAL LOAD + SOCKET UPDATES
  ---------------------------- */
  useEffect(() => {
    searchRef.current = search;
    loadConversations(search);
    return () => {
      if (activeRequestRef.current) {
        activeRequestRef.current.abort();
      }
    };
  }, [search]);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("vine_user"));
    const registerUser = () => {
      if (user?.id) socket.emit("register", user.id);
    };

    if (!socket.connected) socket.connect();
    registerUser();
    socket.on("connect", registerUser);

    loadConversations(searchRef.current);
    // Listen for realtime inbox updates
    const refreshInbox = () => loadConversations(searchRef.current);

    socket.on("dm_received", refreshInbox);
    socket.on("inbox_updated", refreshInbox);
    socket.on("messages_seen", refreshInbox);

    return () => {
      socket.off("connect", registerUser);
      socket.off("dm_received", refreshInbox);
      socket.off("inbox_updated", refreshInbox);
      socket.off("messages_seen", refreshInbox);
    };
  }, []);

  /* ---------------------------
     UI
  ---------------------------- */
  return (
    <div className="dm-list">
 {/* HEADER */}
<div className="dm-header">
  <button
    className="dm-list-back"
    onClick={() => navigate("/vine/feed")}
    aria-label="Back to feed"
    title="Back to feed"
  >
    <span className="dm-list-back-icon">←</span>
    <span className="dm-list-back-label">Feed</span>
  </button>

  <span className="dm-title">💬 Messages</span>
</div>
      <div className="dm-search-row">
        <input
          className="dm-search-input"
          placeholder="Search conversations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="dm-summary-strip" aria-label="Inbox summary">
        <div className="dm-summary-card">
          <span className="dm-summary-label">Inbox</span>
          <strong className="dm-summary-value">{conversations.length}</strong>
          <span className="dm-summary-meta">active chats</span>
        </div>
        <div className="dm-summary-card">
          <span className="dm-summary-label">Unread</span>
          <strong className="dm-summary-value">{unreadMessages}</strong>
          <span className="dm-summary-meta">{unreadChats} chats waiting</span>
        </div>
        <div className="dm-summary-card">
          <span className="dm-summary-label">Pinned</span>
          <strong className="dm-summary-value">{pinnedChats}</strong>
          <span className="dm-summary-meta">quick access</span>
        </div>
      </div>

      {/* EMPTY STATE */}
      {conversations.length === 0 && (
        <div className="dm-empty">No conversations yet</div>
      )}

      {/* CONVERSATIONS */}
      <div className="dm-list-window" ref={listRef}>
      {padTop > 0 && <div style={{ height: `${padTop}px` }} aria-hidden="true" />}
      {visibleConversations.map((c) => {
        const avatar = c.avatar_url
          ? (c.avatar_url.startsWith("http") ? c.avatar_url : `${API}${c.avatar_url}`)
          : DEFAULT_AVATAR;
        const timestampLabel = formatConversationTime(c.last_message_time);
        const timestampTitle = formatConversationTimeTitle(c.last_message_time);

        return (
          <div
            key={c.conversation_id}
            className={`dm-item ${c.unread_count > 0 ? "dm-unread" : ""}`}
            onClick={() => navigate(`/vine/dms/${c.conversation_id}`)}
          >
            {/* AVATAR */}
            <div className="dm-avatar-shell">
              <img
                src={avatar}
                className="dm-avatar"
                alt=""
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/vine/profile/${c.username}`);
                }}
                onError={(e) => {
                  e.currentTarget.src = DEFAULT_AVATAR;
                }}
              />
              {c.unread_count > 0 ? <span className="dm-avatar-unread-dot" aria-hidden="true" /> : null}
            </div>

            {/* META */}
            <div className="dm-meta">
              <div className="dm-top">
                <strong className="dm-username">
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/vine/profile/${c.username}`);
                    }}
                  >
                    @{c.username}
                  </span>
                  {(Number(c.is_verified) === 1 || ["vine guardian","vine_guardian","vine news","vine_news"].includes(String(c.username || "").toLowerCase())) && (
                    <span className={`verified ${["vine guardian","vine_guardian","vine news","vine_news"].includes(String(c.username || "").toLowerCase()) ? "guardian" : ""}`}>
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none">
                        <path
                          d="M20 6L9 17l-5-5"
                          stroke="white"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  )}
                </strong>

                <div className="dm-actions">
                  {timestampLabel && (
                    <time
                      className="dm-time"
                      dateTime={c.last_message_time || ""}
                      title={timestampTitle}
                    >
                      {timestampLabel}
                    </time>
                  )}

                {c.unread_count > 0 && (
                  <span className="dm-badge">{c.unread_count}</span>
                )}

                <button
                  className={`dm-pin ${Number(c.is_pinned) === 1 ? "active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePinConversation(c.conversation_id, Number(c.is_pinned) !== 1);
                  }}
                  title={Number(c.is_pinned) === 1 ? "Unpin chat" : "Pin chat"}
                >
                  📌
                </button>

                {/* DELETE BUTTON */}
                <button
                  className="dm-delete"
                  onClick={(e) => {
                    e.stopPropagation(); // don't open conversation
                    deleteConversation(c.conversation_id);
                  }}
                >
                  🗑️
                </button>
                </div>
              </div>

              <div className="dm-preview">
                {c.last_message || "No messages yet 🌱"}
              </div>
            </div>
          </div>
        );
      })}
      {padBottom > 0 && <div style={{ height: `${padBottom}px` }} aria-hidden="true" />}
      </div>
    </div>
  );
}
