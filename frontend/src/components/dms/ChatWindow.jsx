import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { socket } from "../../socket";
import MessageBubble from "./MessageBubble";
import MessageInput from "./MessageInput";
import "./ChatWindow.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";
const formatLastSeenAgo = (dateString) => {
  if (!dateString) return "";
  const ts = new Date(dateString).getTime();
  if (Number.isNaN(ts)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const isSameDay = (a, b) => {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
};

const formatDayDivider = (dateString) => {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const opts =
    d.getFullYear() === now.getFullYear()
      ? { weekday: "short", month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString("en-US", opts);
};

export default function ChatWindow() {
  const { conversationId: routeConversationId, userId: routeReceiverId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const token = localStorage.getItem("vine_token");
  const receiverId = routeReceiverId ? Number(routeReceiverId) : null;
  const [conversationId, setConversationId] = useState(routeConversationId || null);

  const [messages, setMessages] = useState([]);
  const [partner, setPartner] = useState(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [, setLastSeenTick] = useState(0);

  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const typingRef = useRef({ active: false, timeout: null });

  const currentUser = JSON.parse(localStorage.getItem("vine_user"));
  const myId = currentUser?.id;

  useEffect(() => {
    const timer = setInterval(() => {
      setLastSeenTick((v) => v + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const registerUser = () => {
      if (myId) socket.emit("register", myId);
    };
    if (!socket.connected) socket.connect();
    registerUser();
    socket.on("connect", registerUser);
    return () => {
      socket.off("connect", registerUser);
    };
  }, [myId]);

  useEffect(() => {
    setConversationId(routeConversationId || null);
    stickToBottomRef.current = true;
  }, [routeConversationId]);
// listen for incoming messages//
const handleIncoming = (msg) => {
  if (String(msg.conversation_id) !== String(conversationId)) return;

  // ignore echo of my own message
  if (Number(msg.sender_id) === Number(myId)) return;

  setMessages(prev => {
    if (prev.some(m => m.id === msg.id)) return prev;
    return [...prev, msg];
  });

  // 🔥 MARK AS READ IMMEDIATELY
  // mark as read immediately when message arrives
fetch(`${API}/api/dms/conversations/${conversationId}/read`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
  // 🔥 OPTIONAL: tell sender in realtime
  socket.emit("dm:seen", {
    conversationId,
    messageId: msg.id,
  });
};

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  /* -----------------------------
     Auto scroll when user is near bottom
  ------------------------------ */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  /* -----------------------------
     Load messages
  ------------------------------ */
  useEffect(() => {
    if (!conversationId) return;

    const loadMessages = async () => {
      try {
        const res = await fetch(
          `${API}/api/dms/conversations/${conversationId}/messages`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
    
        if (!res.ok) {
          if (res.status === 403) {
            navigate("/vine/dms");
            return;
          }
          throw new Error("Failed to load");
        }
    
        const data = await res.json();
        setMessages(prev => {
          if (!Array.isArray(data)) return prev;
        
          // prevent duplicate echo after optimistic send
          const lastPrevId = prev.at(-1)?.id;
          const lastNewId = data.at(-1)?.id;
        
          if (lastPrevId === lastNewId) return prev;
          return data;
        });
        
      } catch (err) {
        console.error("Failed to load messages", err);
      }
    };
     

    loadMessages();
  }, [conversationId]);
  //Handle send messages// 
  const uploadDmMedia = async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API}/api/dms/upload-media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data;
  };

  const handleSendMessage = async (payload) => {
    if (!myId) return;
    if (!conversationId && !receiverId) return;
    stickToBottomRef.current = true;
    const content = String(payload?.content || "").trim();
    const mediaFile = payload?.mediaFile || null;
    const mediaType = payload?.mediaType || null;
    const replyToId = payload?.replyToId || null;
    let uploaded = null;
    if (!content && !mediaFile) return;
  
    const tempId = `temp-${Date.now()}`;
  
    const tempMessage = {
      id: tempId,
      sender_id: myId,
      content: content || (mediaType === "voice" ? "Voice note" : "Attachment"),
      created_at: new Date().toISOString(),
      media_url: payload?.localPreview || null,
      media_type: mediaType || null,
      reply_to_id: replyToId || null,
      reply_to_message: replyTarget || null,
      reactions: {},
      viewer_reaction: null,
    };
  
    // 🔥 optimistic UI
    setMessages(prev => [...prev, tempMessage]);
  
    try {
      if (mediaFile) {
        uploaded = await uploadDmMedia(mediaFile);
      }
      const res = await fetch(`${API}/api/dms/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          conversationId
            ? {
                conversationId,
                content,
                media_url: uploaded?.url || null,
                media_type: uploaded?.media_type || null,
                reply_to_id: replyToId || null,
              }
            : {
                receiverId,
                content,
                media_url: uploaded?.url || null,
                media_type: uploaded?.media_type || null,
                reply_to_id: replyToId || null,
              }
        ),
      });
  
      if (!res.ok) throw new Error("Send failed");
  
      const { message: saved, conversationId: savedConversationId } = await res.json();
      if (!conversationId && savedConversationId) {
        setConversationId(savedConversationId);
        navigate(`/vine/dms/${savedConversationId}`, { replace: true });
      }

      // replace temp message with real one
      setMessages(prev =>
        prev.map(m =>
          m.id === tempId
            ? { ...m, ...saved, sender_id: myId }
            : m
        )
      );
      setReplyTarget(null);
    } catch (err) {
      console.error("Send message failed:", err);
      setMessages(prev => prev.filter(m => m.id !== tempId));
    }
  };
  
  
  /* -----------------------------
     Mark as read when opened
  ------------------------------ */
  useEffect(() => {
    if (!conversationId) return;

    fetch(`${API}/api/dms/conversations/${conversationId}/read`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      }
    }).catch(() => {});
  }, [conversationId]);
  // newsish //
  useEffect(() => {
    if (!socket || !conversationId) return;
  
    const handleSeen = ({ conversationId: cid, seenBy }) => {
      if (String(cid) !== String(conversationId)) return;
      if (Number(seenBy) === Number(myId)) return;
  
      setMessages(prev =>
        prev.map(m =>
          m.sender_id === myId ? { ...m, is_read: 1 } : m
        )
      );
    };
  
    socket.on("messages_seen", handleSeen);
  
    return () => {
      socket.off("messages_seen", handleSeen);
    };
  }, [socket, conversationId, myId]);
  useEffect(() => {
    if (!conversationId || !messages.length) return;
  
    // if the last message is NOT mine, mark as read
    const last = messages[messages.length - 1];
    if (Number(last.sender_id) === Number(myId)) return;
  
    fetch(`${API}/api/dms/conversations/${conversationId}/read`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }, [messages, conversationId, myId]);
  

  /* -----------------------------
     Load chat partner
  ------------------------------ */
  useEffect(() => {
    if (!conversationId) {
      if (receiverId) {
        const params = new URLSearchParams(location.search);
        const username = params.get("username") || `user-${receiverId}`;
        const displayName = params.get("displayName") || username;
        setPartner({
          username,
          display_name: displayName,
          avatar_url: null,
          is_verified: 0,
          show_last_active: 0,
        });
      } else {
        setPartner(null);
      }
      return;
    }

    const loadPartner = async () => {
      try {
        const res = await fetch(`${API}/api/dms/conversations`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        const data = await res.json();
        const convo = data.find(
          c => String(c.conversation_id) === String(conversationId)
        );
        if (convo) setPartner(convo);
      } catch (err) {
        console.error("Failed to load partner", err);
      }
    };

    loadPartner();
  }, [conversationId, receiverId, location.search]);

  /* -----------------------------
     Socket realtime
  ------------------------------ */
  useEffect(() => {
    if (!conversationId) return;
  
    const user = JSON.parse(localStorage.getItem("vine_user"));
    const myId = user?.id;
  
    // Join room every time conversation changes
    socket.emit("join_conversation", conversationId);
  
    const handleNewMessage = (msg) => {
      if (String(msg.conversation_id) === String(conversationId)) {
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    };
  
    const handleSeen = ({ conversationId: seenId, seenBy }) => {
      if (String(seenId) === String(conversationId)) {
        if (Number(seenBy) === Number(myId)) return;
        setMessages(prev =>
          prev.map(m =>
            m.sender_id === myId ? { ...m, is_read: 1 } : m
          )
        );
      }
    };
  
    socket.on("dm_received", handleNewMessage);
    socket.on("messages_seen", handleSeen);
    socket.on("dm_message_deleted", ({ message_id, conversation_id }) => {
      if (String(conversation_id) !== String(conversationId)) return;
      setMessages((prev) => prev.filter((m) => Number(m.id) !== Number(message_id)));
    });
    socket.on("dm_typing_start", ({ conversationId: cid, userId }) => {
      if (String(cid) !== String(conversationId)) return;
      if (Number(userId) === Number(myId)) return;
      setPartnerTyping(true);
    });
    socket.on("dm_typing_stop", ({ conversationId: cid, userId }) => {
      if (String(cid) !== String(conversationId)) return;
      if (Number(userId) === Number(myId)) return;
      setPartnerTyping(false);
    });
    socket.on("dm_reaction_updated", ({ message_id, reactions, viewer_reaction, actor_id }) => {
      setMessages((prev) =>
        prev.map((m) =>
          Number(m.id) === Number(message_id)
            ? {
                ...m,
                reactions: reactions || {},
                viewer_reaction:
                  Number(actor_id) === Number(myId)
                    ? viewer_reaction || null
                    : m.viewer_reaction || null,
              }
            : m
        )
      );
    });
  
    return () => {
      socket.off("dm_received", handleNewMessage);
      socket.off("messages_seen", handleSeen);
      socket.off("dm_message_deleted");
      socket.off("dm_typing_start");
      socket.off("dm_typing_stop");
      socket.off("dm_reaction_updated");
    };
  }, [conversationId, myId]);

  useEffect(() => {
    return () => {
      if (typingRef.current.timeout) clearTimeout(typingRef.current.timeout);
    };
  }, []);

  const handleTyping = (value) => {
    if (!conversationId || !myId) return;
    const hasText = String(value || "").length > 0;
    if (hasText && !typingRef.current.active) {
      socket.emit("dm_typing_start", { conversationId, userId: myId });
      typingRef.current.active = true;
    }
    if (typingRef.current.timeout) clearTimeout(typingRef.current.timeout);
    typingRef.current.timeout = setTimeout(() => {
      if (typingRef.current.active) {
        socket.emit("dm_typing_stop", { conversationId, userId: myId });
        typingRef.current.active = false;
      }
    }, 1200);
    if (!hasText && typingRef.current.active) {
      socket.emit("dm_typing_stop", { conversationId, userId: myId });
      typingRef.current.active = false;
    }
  };

  const handleReact = async (message, reaction) => {
    try {
      const res = await fetch(`${API}/api/dms/messages/${message.id}/reaction`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reaction }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setMessages((prev) =>
        prev.map((m) =>
          Number(m.id) === Number(message.id)
            ? {
                ...m,
                reactions: data.reactions || {},
                viewer_reaction: data.viewer_reaction || null,
              }
            : m
        )
      );
    } catch {}
  };

  const handleDeleteMessage = async (message) => {
    if (!message?.id || String(message.id).startsWith("temp-")) return;
    if (!window.confirm("Delete this message?")) return;
    try {
      const res = await fetch(`${API}/api/dms/messages/${message.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      setMessages((prev) => prev.filter((m) => Number(m.id) !== Number(message.id)));
    } catch {}
  };
 
  useEffect(() => {
    if (!conversationId) return;
  
    const token = localStorage.getItem("vine_token");
  
    // Mark as read every time we open the chat
    fetch(`${API}/api/dms/conversations/${conversationId}/read`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }, [conversationId]);
  
  /* -----------------------------
     UI
  ------------------------------ */
  return (
    <div className="vine-chat-wrapper">

      {/* HEADER */}
      <div className="chat-header">
        <button className="back-btn" onClick={() => navigate("/vine/dms")}>←</button>

        {partner ? (
          <div
            className="chat-user"
            onClick={() => navigate(`/vine/profile/${partner.username}`)}
          >
            <img
              src={
                partner.avatar_url
                  ? (partner.avatar_url.startsWith("http")
                      ? partner.avatar_url
                      : `${API}${partner.avatar_url}`)
                  : DEFAULT_AVATAR
              }
              alt=""
              className="chat-avatar"
              onError={(e) => {
                e.currentTarget.src = DEFAULT_AVATAR;
              }}
            />

            <div className="chat-header-meta">
              <strong
                className="chat-name"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/vine/profile/${partner.username}`);
                }}
              >
                <span>{partner.display_name || partner.username}</span>
                {(Number(partner.is_verified) === 1 || ["vine guardian","vine_guardian","vine news","vine_news"].includes(String(partner.username || "").toLowerCase())) && (
                  <span className={`verified ${["vine guardian","vine_guardian","vine news","vine_news"].includes(String(partner.username || "").toLowerCase()) ? "guardian" : ""}`}>
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
              {partnerTyping ? (
                <div className="chat-lastseen typing">typing…</div>
              ) : partner.show_last_active !== 0 && partner.last_active_at && (
                <div className="chat-lastseen">
                  Last seen {formatLastSeenAgo(partner.last_active_at)}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ opacity: 0.6 }}>Loading chat…</div>
        )}
      </div>

      {/* MESSAGES */}
            <div
              className="messages-container"
              ref={scrollRef}
              onScroll={() => {
                stickToBottomRef.current = isNearBottom();
              }}
            >
        {messages.length === 0 ? (
          <div className="chat-empty">Start of your Vine history 🌱</div>
        ) : (
          messages.map((m, i) => {
            const prev = i > 0 ? messages[i - 1] : null;
            const showDayDivider = !prev || !isSameDay(prev.created_at, m.created_at);

            return (
              <div key={`${m.id}-${m.sender_id}-${i}`}>
                {showDayDivider && (
                  <div className="chat-day-divider">
                    <span>{formatDayDivider(m.created_at)}</span>
                  </div>
                )}
                <MessageBubble
                  message={m}
                  onReply={(msg) => setReplyTarget(msg)}
                  onReact={handleReact}
                  onDelete={handleDeleteMessage}
                />
              </div>
            );
          })
          
        )}
          </div>


      {/* INPUT */}
      <div className="chat-footer">
      <MessageInput
        onSend={handleSendMessage}
        replyTarget={replyTarget}
        onCancelReply={() => setReplyTarget(null)}
        onTyping={handleTyping}
      />
      </div>
    </div>
  );
}
