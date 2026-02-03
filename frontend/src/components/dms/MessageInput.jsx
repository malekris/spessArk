import { useState } from "react";
import { socket } from "../../socket";
import "./MessageInput.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function MessageInput({ onSend }) {
  const [text, setText] = useState("");

  const send = () => {
    if (!text.trim()) return;

    onSend(text);   // 🔥 send up to ChatWindow
    setText("");    // clear instantly
  };
  const handleSendMessage = async (content) => {
    const tempMessage = {
      id: `temp-${Date.now()}`,
      sender_id: myUserId,
      content,
      created_at: new Date().toISOString(),
    };
  
    setMessages(prev => [...prev, tempMessage]);
  
    await fetch(`${API}/api/dms/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversationId,
        content,
      }),
    });
  };
  

  return (
    <div className="chat-input-bar">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a message..."
        className="chat-input"
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
        }}
      />

      <button onClick={send} className="chat-send-btn">
        📤
      </button>
    </div>
  );
}

