import { useNavigate } from "react-router-dom";
import "./MessageBubbles.css"; // Import the new styles

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function MessageBubble({ message }) {
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("vine_user"));
  const myId = currentUser?.id;
  const isMine = Number(message.sender_id) === Number(myId);

  let avatar = message.avatar_url 
    ? (message.avatar_url.startsWith("http") ? message.avatar_url : `${API}${message.avatar_url}`) 
    : null;

  return (
    <div className={`msg-row ${isMine ? "mine" : "theirs"}`}>
      {/* LEFT SIDE AVATAR */}
      {!isMine && (
        <div className="msg-avatar-wrapper" onClick={() => navigate(`/vine/profile/${message.username}`)}>
          {avatar ? (
            <img src={avatar} alt="avatar" className="msg-avatar" />
          ) : (
            <div className="msg-fallback">
              {message.username?.[0]?.toUpperCase() || "?"}
            </div>
          )}
        </div>
      )}

      {/* MESSAGE + SEEN */}
      <div className="msg-content-wrapper">
        <div className="msg-bubble">
          {!isMine && <div className="msg-sender-handle">@{message.username}</div>}
          {message.content}
        </div>

        {isMine && message.is_read === 1 && (
          <div className="msg-seen">Seen</div>
        )}
      </div>
    </div>
  );
}