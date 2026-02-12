import "./MessageBubbles.css"; // Import the new styles

export default function MessageBubble({ message }) {
  const currentUser = JSON.parse(localStorage.getItem("vine_user"));
  const myId = currentUser?.id;
  const isMine = Number(message.sender_id) === Number(myId);

  return (
    <div className={`msg-row ${isMine ? "mine" : "theirs"}`}>
      {/* MESSAGE + SEEN */}
      <div className="msg-content-wrapper">
        <div className="msg-bubble">
          {message.content}
        </div>

        {isMine && message.is_read === 1 && (
          <div className="msg-seen">Seen</div>
        )}
      </div>
    </div>
  );
}
