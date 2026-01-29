import { useEffect, useState } from "react";
import ConversationList from "./ConversationList";
import ChatWindow from "./ChatWindow";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function DmsPage() {
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const token = localStorage.getItem("vine_token");

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`${API}/api/dms/conversations`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      setConversations(data || []);
    };

    load();
  }, []);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <ConversationList
        conversations={conversations}
        activeId={activeConversation?.conversation_id}
        onSelect={(id) =>
          setActiveConversation(
            conversations.find(c => c.conversation_id === id)
          )
        }
      />

      <ChatWindow conversation={activeConversation} />
    </div>
  );
}
