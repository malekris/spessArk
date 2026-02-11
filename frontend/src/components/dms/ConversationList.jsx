import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./ConversationList.css";
import { socket } from "../../socket";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

export default function ConversationList() {
  /* ---------------------------
     STATE & GLOBALS
  ---------------------------- */
  const [conversations, setConversations] = useState([]);
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");

  /* ---------------------------
     FETCH CONVERSATIONS
  ---------------------------- */
  const loadConversations = async () => {
    try {
      const res = await fetch(`${API}/api/dms/conversations`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      setConversations(data || []);
    } catch (err) {
      console.error("Failed to load conversations", err);
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
    loadConversations();

    // Listen for realtime inbox updates
    const refreshInbox = () => loadConversations();

    socket.on("dm_received", refreshInbox);
    socket.on("inbox_updated", refreshInbox);

    return () => {
      socket.off("dm_received", refreshInbox);
      socket.off("inbox_updated", refreshInbox);
    };
  }, []);

  /* ---------------------------
     UI
  ---------------------------- */
  return (
    <div className="dm-list">
 {/* HEADER */}
<div className="dm-header">
  <button className="dm-mint-pill-btn" onClick={() => navigate("/vine/feed")}>
    <span className="icon">←</span>
    <span className="label">🌱 Vine Feed</span>
  </button>

  <span className="dm-title">💬 Messages</span>
</div>

      {/* EMPTY STATE */}
      {conversations.length === 0 && (
        <div className="dm-empty">No conversations yet</div>
      )}

      {/* CONVERSATIONS */}
      {conversations.map((c) => {
        const avatar = c.avatar_url
          ? (c.avatar_url.startsWith("http") ? c.avatar_url : `${API}${c.avatar_url}`)
          : DEFAULT_AVATAR;

        return (
          <div
            key={c.conversation_id}
            className={`dm-item ${c.unread_count > 0 ? "dm-unread" : ""}`}
            onClick={() => navigate(`/vine/dms/${c.conversation_id}`)}
          >
            {/* AVATAR */}
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
                  {(Number(c.is_verified) === 1 || ["vine guardian","vine_guardian"].includes(String(c.username || "").toLowerCase())) && (
                    <span className={`verified ${["vine guardian","vine_guardian"].includes(String(c.username || "").toLowerCase()) ? "guardian" : ""}`}>
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

                {c.unread_count > 0 && (
                  <span className="dm-badge">{c.unread_count}</span>
                )}

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

              <div className="dm-preview">
                {c.last_message || "No messages yet 🌱"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
