import { useRef, useState } from "react";
import "./MessageInput.css";

const VOICE_RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

const pickVoiceRecorderMimeType = () => {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  for (const mimeType of VOICE_RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return "";
};

const normalizeVoiceFileMime = (rawMime) => {
  const mime = String(rawMime || "").toLowerCase();
  if (mime.includes("mp4") || mime.includes("aac")) return "audio/mp4";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "audio/mpeg";
  if (mime.includes("ogg")) return "audio/ogg";
  if (mime.includes("wav")) return "audio/wav";
  return "audio/webm";
};

const voiceFileExtensionForMime = (rawMime) => {
  const mime = normalizeVoiceFileMime(rawMime);
  if (mime === "audio/mp4") return "m4a";
  if (mime === "audio/mpeg") return "mp3";
  if (mime === "audio/ogg") return "ogg";
  if (mime === "audio/wav") return "wav";
  return "webm";
};

export default function MessageInput({ onSend, replyTarget, onCancelReply, onTyping }) {
  const [text, setText] = useState("");
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaType, setMediaType] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const fileInputRef = useRef(null);

  const syncText = (nextValue) => {
    setText(nextValue);
    onTyping?.(nextValue);
  };

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
      const preferredMimeType = pickVoiceRecorderMimeType();
      const rec = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const chunkMime =
          chunksRef.current.find((chunk) => String(chunk?.type || "").trim())?.type ||
          rec.mimeType ||
          preferredMimeType ||
          "audio/webm";
        const fileMime = normalizeVoiceFileMime(chunkMime);
        const blob = new Blob(chunksRef.current, { type: fileMime });
        const file = new File([blob], `voice-${Date.now()}.${voiceFileExtensionForMime(fileMime)}`, {
          type: fileMime,
        });
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
    const retainedPreview =
      mediaFile && previewUrl?.startsWith("blob:")
        ? URL.createObjectURL(mediaFile)
        : previewUrl;
    onSend({
      content,
      mediaFile,
      mediaType,
      localPreview: retainedPreview,
      replyToId: replyTarget?.id || null,
    });
    syncText("");
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
            syncText(e.target.value);
          }}
          onInput={(e) => syncText(e.currentTarget.value)}
          onPaste={(e) => {
            queueMicrotask(() => syncText(e.currentTarget.value));
          }}
          onCompositionEnd={(e) => syncText(e.currentTarget.value)}
          onBlur={() => onTyping?.("")}
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
