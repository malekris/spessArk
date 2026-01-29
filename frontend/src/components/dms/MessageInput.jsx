import { useState } from "react";
import { socket } from "../../socket";
import "./MessageInput.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function MessageInput({ conversationId }) {
  const [text, setText] = useState("");
  const token = localStorage.getItem("vine_token");

  const send = async () => {
    if (!text.trim() || !conversationId) return;

    try {
      const res = await fetch(`${API}/api/dms/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversationId,
          content: text,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to send");
        return;
      }

      

      setText(""); // clear input after send
    } catch (err) {
      console.error("Send message error:", err);
    }
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
