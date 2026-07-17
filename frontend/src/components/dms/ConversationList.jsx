import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./ConversationList.css";
import { socket } from "../../socket";
import useWindowedList from "../../hooks/useWindowedList";
import GroupCreateModal from "./GroupCreateModal";
import "./GroupCreateModal.css";

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

  const dayDifference = Math.floor((now.getTime() - parsed.getTime()) / (24 * 60 * 60 * 1000));
  if (dayDifference >= 0 && dayDifference < 7) {
    return parsed.toLocaleDateString([], { weekday: "short" });
  }

  const sameYear = parsed.getFullYear() === now.getFullYear();
  return parsed.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
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
  const [filter, setFilter] = useState("all");
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const searchRef = useRef("");
  const listRef = useRef(null);
  const activeRequestRef = useRef(null);
  const hasLoadedRef = useRef(false);
  const realtimeRefreshRef = useRef(null);
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");
  const unreadChats = conversations.filter((item) => Number(item?.unread_count || 0) > 0).length;
  const pinnedChats = conversations.filter((item) => Number(item?.is_pinned) === 1).length;
  const groupChats = conversations.filter((item) => item?.conversation_type === "group").length;
  const filteredConversations = useMemo(() => {
    if (filter === "unread") return conversations.filter((item) => Number(item?.unread_count || 0) > 0);
    if (filter === "groups") return conversations.filter((item) => item?.conversation_type === "group");
    if (filter === "pinned") return conversations.filter((item) => Number(item?.is_pinned) === 1);
    return conversations;
  }, [conversations, filter]);
  const {
    visibleItems: visibleConversations,
    padTop,
    padBottom,
  } = useWindowedList(filteredConversations, {
    containerRef: listRef,
    estimatedItemHeight: 112,
    overscan: 5,
    enabled: filteredConversations.length > 24,
  });
  const inboxFilters = [
    { id: "all", label: "All", count: conversations.length },
    { id: "unread", label: "Unread", count: unreadChats },
    { id: "groups", label: "Groups", count: groupChats },
    { id: "pinned", label: "Pinned", count: pinnedChats },
  ];

  /* ---------------------------
     FETCH CONVERSATIONS
  ---------------------------- */
  const loadConversations = useCallback(async (query = "") => {
    let controller;
    try {
      if (activeRequestRef.current) {
        activeRequestRef.current.abort();
      }
      controller = new AbortController();
      activeRequestRef.current = controller;
      if (!hasLoadedRef.current) setLoading(true);
      setLoadError("");
      const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const res = await fetch(`${API}/api/dms/conversations${qs}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });

      const data = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok) throw new Error(data?.error || "Could not load messages");
      setConversations(Array.isArray(data) ? data : []);
      hasLoadedRef.current = true;
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error("Failed to load conversations", err);
      if (!hasLoadedRef.current) setLoadError(err?.message || "Could not load messages");
    } finally {
      if (controller && !controller.signal.aborted) setLoading(false);
    }
  }, [token]);

  const togglePinConversation = async (id, pinned) => {
    try {
      const response = await fetch(`${API}/api/dms/conversations/${id}/pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pinned }),
      });
      if (!response.ok) throw new Error("Could not update pinned conversation");
      loadConversations(searchRef.current);
    } catch (err) {
      console.error("Pin failed", err);
    }
  };

  /* ---------------------------
     DELETE CONVERSATION
  ---------------------------- */
  const deleteConversation = async (id, label) => {
    if (!window.confirm(`Delete your conversation with ${label}?`)) return;
    try {
      const response = await fetch(`${API}/api/dms/conversations/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Could not delete conversation");
      setConversations((current) => current.filter((item) => Number(item.conversation_id) !== Number(id)));
    } catch (err) {
      console.error("Delete failed", err);
      setLoadError(err?.message || "Could not delete conversation");
    }
  };

  /* ---------------------------
     INITIAL LOAD + SOCKET UPDATES
  ---------------------------- */
  useEffect(() => {
    searchRef.current = search;
    const searchTimer = window.setTimeout(() => loadConversations(search), 180);
    return () => {
      window.clearTimeout(searchTimer);
      if (activeRequestRef.current) {
        activeRequestRef.current.abort();
      }
    };
  }, [loadConversations, search]);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("vine_user"));
    const registerUser = () => {
      if (user?.id) socket.emit("register", user.id);
    };

    if (!socket.connected) socket.connect();
    registerUser();
    socket.on("connect", registerUser);

    // Listen for realtime inbox updates
    const refreshInbox = () => {
      window.clearTimeout(realtimeRefreshRef.current);
      realtimeRefreshRef.current = window.setTimeout(
        () => loadConversations(searchRef.current),
        120
      );
    };

    socket.on("dm_received", refreshInbox);
    socket.on("inbox_updated", refreshInbox);
    socket.on("messages_seen", refreshInbox);

    return () => {
      socket.off("connect", registerUser);
      socket.off("dm_received", refreshInbox);
      socket.off("inbox_updated", refreshInbox);
      socket.off("messages_seen", refreshInbox);
      window.clearTimeout(realtimeRefreshRef.current);
    };
  }, [loadConversations]);

  /* ---------------------------
     UI
  ---------------------------- */
  return (
    <div className="dm-list">
      <header className="dm-header">
        <button className="dm-list-back" onClick={() => navigate("/vine/feed")} aria-label="Back to feed" title="Back to feed">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
            <path d="m14.5 5-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="dm-title-block">
          <h1 className="dm-title">Messages</h1>
          <span>{conversations.length} conversations</span>
        </div>
        <button className="dm-new-group" type="button" onClick={() => setGroupModalOpen(true)} title="Create group">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <path d="M8.5 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM15.5 11a3.2 3.2 0 1 0 0-6.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M2.5 20c.4-3.6 2.4-5.4 6-5.4s5.6 1.8 6 5.4M15 14.2c3.8 0 5.8 1.8 6.1 5.4M18.5 9.5v5M16 12h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>New group</span>
        </button>
      </header>

      <section className="dm-inbox-controls" aria-label="Message filters">
        <label className="dm-search-box">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
            <path d="m16 16 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            className="dm-search-input"
            aria-label="Search conversations"
            placeholder="Search messages"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button type="button" className="dm-search-clear" onClick={() => setSearch("")} aria-label="Clear search" title="Clear search">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </label>
        <div className="dm-filter-tabs" role="tablist" aria-label="Inbox views">
          {inboxFilters.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={filter === item.id ? "active" : ""}
              onClick={() => setFilter(item.id)}
            >
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </button>
          ))}
        </div>
      </section>

      <div className="dm-list-heading">
        <strong>{inboxFilters.find((item) => item.id === filter)?.label || "All"}</strong>
        <span>{filteredConversations.length} {filteredConversations.length === 1 ? "conversation" : "conversations"}</span>
      </div>

      {loading && (
        <div className="dm-list-window dm-list-loading" aria-label="Loading conversations">
          {[0, 1, 2, 3, 4].map((item) => <div className="dm-item-skeleton" key={item} />)}
        </div>
      )}

      {loadError && !loading && (
        <div className="dm-load-error" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => loadConversations(searchRef.current)}>Retry</button>
        </div>
      )}

      {!loading && !loadError && filteredConversations.length === 0 && (
        <div className="dm-empty">
          <span className="dm-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="25" height="25" fill="none">
              <path d="M5 6.5h14v9H9l-4 3v-12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </span>
          <strong>
            {search
              ? "No matching conversations"
              : filter === "all"
                ? "No messages yet"
                : filter === "groups"
                  ? "No group conversations"
                  : `No ${filter} conversations`}
          </strong>
          {(search || filter !== "all") && (
            <button type="button" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</button>
          )}
        </div>
      )}

      {!loading && !loadError && filteredConversations.length > 0 && (
      <div className="dm-list-window" ref={listRef}>
        {padTop > 0 && <div style={{ height: `${padTop}px` }} aria-hidden="true" />}
        {visibleConversations.map((c) => {
          const isGroup = c.conversation_type === "group";
          const unreadCount = Number(c.unread_count || 0);
          const isPinned = Number(c.is_pinned) === 1;
          const isGuardianAccount = ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
            String(c.username || "").toLowerCase()
          );
          const displayName = isGroup ? c.group_name : (c.display_name || c.username);
          const identityLabel = isGroup ? `${Number(c.member_count || 0)} members` : `@${c.username}`;
          const avatar = c.avatar_url
            ? (c.avatar_url.startsWith("http") ? c.avatar_url : `${API}${c.avatar_url}`)
            : DEFAULT_AVATAR;
          const timestampLabel = formatConversationTime(c.last_message_time);
          const timestampTitle = formatConversationTimeTitle(c.last_message_time);

          return (
            <div
              key={c.conversation_id}
              className={`dm-item ${unreadCount > 0 ? "dm-unread" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`Open conversation with ${displayName}`}
              onClick={() => navigate(`/vine/dms/${c.conversation_id}`)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") navigate(`/vine/dms/${c.conversation_id}`);
              }}
            >
              <div className="dm-avatar-shell">
                {isGroup && c.avatar_url ? (
                  <img src={avatar} className="dm-avatar dm-group-avatar" alt="" onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }} />
                ) : isGroup ? (
                  <div className="dm-avatar-fallback dm-group-avatar" aria-hidden="true">
                    {String(c.group_name || "G").trim().slice(0, 2).toUpperCase()}
                  </div>
                ) : (
                  <img
                    src={avatar}
                    className="dm-avatar"
                    alt=""
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate(`/vine/profile/${c.username}`);
                    }}
                    onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }}
                  />
                )}
                {!isGroup && Number(c.is_online_now) === 1 && <span className="dm-avatar-presence" aria-label="Online" title="Online" />}
              </div>

              <div className="dm-meta">
                <div className="dm-identity-line">
                  <strong className="dm-username">{displayName}</strong>
                  {!isGroup && (Number(c.is_verified) === 1 || isGuardianAccount) && (
                    <span className={`dm-verified-badge ${isGuardianAccount ? "guardian" : ""}`} aria-label="Verified" title="Verified">
                      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                  <span className="dm-identity-label">{identityLabel}</span>
                  {isPinned && (
                    <span className="dm-pinned-marker" aria-label="Pinned" title="Pinned">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
                        <path d="m9 4 6 0-.5 4 2.5 2.5v1H7v-1L9.5 8 9 4Zm3 7.5V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </div>
                <p className="dm-preview">{c.last_message || "No messages yet"}</p>
              </div>

              <div className="dm-conversation-side">
                {timestampLabel && <time className="dm-time" dateTime={c.last_message_time || ""} title={timestampTitle}>{timestampLabel}</time>}
                <div className="dm-side-actions">
                  {unreadCount > 0 && <span className="dm-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
                  <details className="dm-row-menu" name="dm-conversation-actions" onClick={(event) => event.stopPropagation()}>
                    <summary aria-label={`Actions for ${displayName}`} title="Conversation actions">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
                      </svg>
                    </summary>
                    <div className="dm-row-menu-popover">
                      <button type="button" onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        togglePinConversation(c.conversation_id, !isPinned);
                      }}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                          <path d="m9 4 6 0-.5 4 2.5 2.5v1H7v-1L9.5 8 9 4Zm3 7.5V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {isPinned ? "Unpin" : "Pin"}
                      </button>
                      <button className="danger" type="button" onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        deleteConversation(c.conversation_id, displayName);
                      }}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                          <path d="M8 8v10m4-10v10m4-10v10M5 5h14M9 5l1-2h4l1 2m2 0-1 16H8L7 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          );
        })}
        {padBottom > 0 && <div style={{ height: `${padBottom}px` }} aria-hidden="true" />}
      </div>
      )}
      <GroupCreateModal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        onCreated={(data) => {
          setGroupModalOpen(false);
          loadConversations();
          if (data?.conversationId) navigate(`/vine/dms/${data.conversationId}`);
        }}
      />
    </div>
  );
}
