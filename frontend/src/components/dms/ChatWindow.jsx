import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { socket } from "../../socket";
import MessageBubble from "./MessageBubble";
import MessageInput from "./MessageInput";
import "./ChatWindow.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function ChatWindow() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");

  const [messages, setMessages] = useState([]);
  const [partner, setPartner] = useState(null);

  const scrollRef = useRef(null);

  const currentUser = JSON.parse(localStorage.getItem("vine_user"));
  const myId = currentUser?.id;

  /* -----------------------------
     Auto scroll when messages change
  ------------------------------ */
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
        setMessages(Array.isArray(data) ? data : []);
    
      } catch (err) {
        console.error("Failed to load messages", err);
      }
    };
     

    loadMessages();
  }, [conversationId]);

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

  /* -----------------------------
     Load chat partner
  ------------------------------ */
  useEffect(() => {
    if (!conversationId) return;

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
  }, [conversationId]);

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
              src={partner.avatar_url || "/default-avatar.png"}

              alt=""
              className="chat-avatar"
            />

            <div>
              <strong>{partner.display_name || partner.username}</strong>
              <div style={{ fontSize: 12, opacity: 0.6 }}>
                @{partner.username}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ opacity: 0.6 }}>Loading chat…</div>
        )}
      </div>

      {/* MESSAGES */}
      <div className="messages-container" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">Start of your Vine history 🌱</div>
        ) : (
          messages.map(m => (
            <MessageBubble key={m.id} message={m} />
          ))
        )}
      </div>

      {/* INPUT */}
      <div className="chat-footer">
        <MessageInput conversationId={conversationId} />
      </div>
    </div>
  );
}
