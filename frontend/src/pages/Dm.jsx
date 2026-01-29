import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { socket } from "../socket";
import ConversationList from "../components/dms/ConversationList";
import ChatWindow from "../components/dms/ChatWindow";
import api from "../api"; // whatever axios wrapper you use

export default function Dms() {
  const { conversationId } = useParams();
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(conversationId || null);

  useEffect(() => {
    api.get("/dms/conversations")
      .then(res => setConversations(res.data))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (activeId) {
      socket.emit("join_conversation", activeId);
    }
  }, [activeId]);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <ConversationList 
        conversations={conversations}
        onSelect={setActiveId}
        activeId={activeId}
      />
      {activeId ? (
        <ChatWindow conversationId={activeId} />
      ) : (
        <div style={{ flex: 1, padding: 20 }}>Select a conversation</div>
      )}
    </div>
  );
}
