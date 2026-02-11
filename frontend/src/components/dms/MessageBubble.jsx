import { useNavigate } from "react-router-dom";
import "./MessageBubbles.css"; // Import the new styles

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

export default function MessageBubble({ message }) {
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("vine_user"));
  const myId = currentUser?.id;
  const isMine = Number(message.sender_id) === Number(myId);

  let avatar = message.avatar_url 
    ? (message.avatar_url.startsWith("http") ? message.avatar_url : `${API}${message.avatar_url}`) 
    : DEFAULT_AVATAR;

  return (
    <div className={`msg-row ${isMine ? "mine" : "theirs"}`}>
      {/* LEFT SIDE AVATAR */}
      {!isMine && (
        <div className="msg-avatar-wrapper" onClick={() => navigate(`/vine/profile/${message.username}`)}>
          <img
            src={avatar}
            alt="avatar"
            className="msg-avatar"
            onError={(e) => {
              e.currentTarget.src = DEFAULT_AVATAR;
            }}
          />
        </div>
      )}

      {/* MESSAGE + SEEN */}
      <div className="msg-content-wrapper">
        <div className="msg-bubble">
          {!isMine && (
            <div className="msg-sender-handle">
              <span>@{message.username}</span>
              {(Number(message.is_verified) === 1 || ["vine guardian","vine_guardian"].includes(String(message.username || "").toLowerCase())) && (
                <span className={`verified ${["vine guardian","vine_guardian"].includes(String(message.username || "").toLowerCase()) ? "guardian" : ""}`}>
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none">
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
            </div>
          )}
          {message.content}
        </div>

        {isMine && message.is_read === 1 && (
          <div className="msg-seen">Seen</div>
        )}
      </div>
    </div>
  );
}
