import "./MessageBubbles.css"; // Import the new styles

const REACTION_SET = ["👍", "❤️", "😂", "🔥"];

export default function MessageBubble({ message, onReply, onReact, onDelete }) {
  const currentUser = JSON.parse(localStorage.getItem("vine_user"));
  const myId = currentUser?.id;
  const isMine = Number(message.sender_id) === Number(myId);
  const reactions = message?.reactions || {};

  return (
    <div className={`msg-row ${isMine ? "mine" : "theirs"}`}>
      <div className="msg-content-wrapper">
        {message.reply_to_message && (
          <div className="dm-reply-preview">
            <strong>{message.reply_to_message.display_name || message.reply_to_message.username}</strong>
            <span>{message.reply_to_message.content}</span>
          </div>
        )}
        <div className="msg-bubble">
          {message.media_url && message.media_type === "image" && (
            <img className="dm-media-img" src={message.media_url} alt="sent media" />
          )}
          {message.media_url && message.media_type === "voice" && (
            <audio className="dm-media-audio" controls src={message.media_url} />
          )}
          {message.content}
        </div>

        <div className="dm-message-actions">
          <button type="button" onClick={() => onReply?.(message)}>↩️ Reply</button>
          {isMine && !String(message.id || "").startsWith("temp-") && (
            <button type="button" className="delete" onClick={() => onDelete?.(message)}>
              🗑️ Delete
            </button>
          )}
          {REACTION_SET.map((emoji) => (
            <button
              key={`${message.id}-${emoji}`}
              type="button"
              className={message.viewer_reaction === emoji ? "active" : ""}
              onClick={() => onReact?.(message, message.viewer_reaction === emoji ? "" : emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>

        {Object.keys(reactions).length > 0 && (
          <div className="dm-reactions-row">
            {Object.entries(reactions).map(([k, v]) => (
              <span key={`${message.id}-r-${k}`}>{k} {v}</span>
            ))}
          </div>
        )}

        {isMine && String(message.id || "").startsWith("temp-") === false && (
          <div className="msg-seen">
            {Number(message.is_read) === 1 ? "Seen" : "Delivered"}
          </div>
        )}
      </div>
    </div>
  );
}
