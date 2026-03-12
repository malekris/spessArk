import { useRef, useState } from "react";
import "./MessageInput.css";

export default function MessageInput({ onSend, replyTarget, onCancelReply, onTyping }) {
  const [text, setText] = useState("");
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaType, setMediaType] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const fileInputRef = useRef(null);

  const resetMedia = () => {
    setMediaFile(null);
    setMediaType(null);
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
  };

  const onPickImage = (file) => {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      alert("Only images are allowed here.");
      return;
    }
    resetMedia();
    setMediaFile(file);
    setMediaType("image");
    setPreviewUrl(URL.createObjectURL(file));
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        alert("Voice recording is not supported on this device/browser.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
        resetMedia();
        setMediaFile(file);
        setMediaType("voice");
        setPreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      alert("Microphone permission denied.");
    }
  };

  const stopRecording = () => {
    if (!recorderRef.current) return;
    recorderRef.current.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const send = () => {
    const content = String(text || "").trim();
    if (!content && !mediaFile) return;
    onSend({
      content,
      mediaFile,
      mediaType,
      localPreview: previewUrl,
      replyToId: replyTarget?.id || null,
    });
    setText("");
    resetMedia();
  };

  return (
    <div className="chat-input-wrap">
      {replyTarget && (
        <div className="dm-reply-bar">
          <div className="dm-reply-label">
            Replying to {replyTarget.display_name || replyTarget.username}: {String(replyTarget.content || "").slice(0, 80)}
          </div>
          <button type="button" onClick={onCancelReply}>✕</button>
        </div>
      )}

      {previewUrl && (
        <div className="dm-media-preview">
          {mediaType === "image" ? (
            <img src={previewUrl} alt="preview" />
          ) : (
            <audio controls src={previewUrl} />
          )}
          <button type="button" onClick={resetMedia}>Remove</button>
        </div>
      )}

      <div className="chat-input-bar">
        <button type="button" className="chat-icon-btn" onClick={() => fileInputRef.current?.click()} title="Send image">
          🖼️
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            onPickImage(file);
          }}
        />

        <button
          type="button"
          className={`chat-icon-btn ${recording ? "recording" : ""}`}
          onClick={recording ? stopRecording : startRecording}
          title={recording ? "Stop recording" : "Record voice note"}
        >
          {recording ? "⏹️" : "🎤"}
        </button>

        <input
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            onTyping?.(next);
          }}
          placeholder="Type a message..."
          className="chat-input"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />

        <button type="button" onClick={send} className="chat-send-btn">📤</button>
      </div>
    </div>
  );
}
