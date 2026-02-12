import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { socket } from "../../socket";
import MessageBubble from "./MessageBubble";
import MessageInput from "./MessageInput";
import "./ChatWindow.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";
const formatChatDateTime = (dateString) => {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const dateOpts =
    d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  const datePart = d.toLocaleDateString("en-US", dateOpts);
  const timePart = d
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
  return `${datePart} at ${timePart}`;
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

  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const currentUser = JSON.parse(localStorage.getItem("vine_user"));
  const myId = currentUser?.id;

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
  const handleSendMessage = async (content) => {
    if (!myId) return;
    if (!conversationId && !receiverId) return;
    stickToBottomRef.current = true;
  
    const tempId = `temp-${Date.now()}`;
  
    const tempMessage = {
      id: tempId,
      sender_id: myId,
      content,
      created_at: new Date().toISOString(),
    };
  
    // 🔥 optimistic UI
    setMessages(prev => [...prev, tempMessage]);
  
    try {
      const res = await fetch(`${API}/api/dms/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          conversationId
            ? { conversationId, content }
            : { receiverId, content }
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
  
    const handleSeen = ({ conversationId: cid }) => {
      if (String(cid) !== String(conversationId)) return;
  
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
  
    const handleSeen = ({ conversationId: seenId }) => {
      if (String(seenId) === String(conversationId)) {
        setMessages(prev =>
          prev.map(m =>
            m.sender_id === myId ? { ...m, is_read: 1 } : m
          )
        );
      }
    };
  
    socket.on("dm_received", handleNewMessage);
    socket.on("messages_seen", handleSeen);
  
    return () => {
      socket.off("dm_received", handleNewMessage);
      socket.off("messages_seen", handleSeen);
    };
  }, [conversationId]);
 
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
                {(Number(partner.is_verified) === 1 || ["vine guardian","vine_guardian"].includes(String(partner.username || "").toLowerCase())) && (
                  <span className={`verified ${["vine guardian","vine_guardian"].includes(String(partner.username || "").toLowerCase()) ? "guardian" : ""}`}>
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
              {partner.show_last_active !== 0 && partner.last_active_at && (
                <div className="chat-lastseen">
                  Last seen on {formatChatDateTime(partner.last_active_at)}
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
                <MessageBubble message={m} />
              </div>
            );
          })
          
        )}
          </div>


      {/* INPUT */}
      <div className="chat-footer">
      <MessageInput onSend={handleSendMessage} />
      </div>
    </div>
  );
}
