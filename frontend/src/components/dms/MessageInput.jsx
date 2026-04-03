import { useRef, useState } from "react";
import "./MessageInput.css";
import { convertHeicFileToJpeg, isHeicLikeFile } from "../../modules/vine/utils/heic";

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

const buildPreviewItems = (files, mediaType) => {
  const list = Array.from(files || []);
  return list.map((file) => ({
    url: URL.createObjectURL(file),
    type: mediaType,
    name: file?.name || "",
    revoke: true,
  }));
};

export default function MessageInput({ onSend, replyTarget, onCancelReply, onTyping }) {
  const [text, setText] = useState("");
  const [mediaFiles, setMediaFiles] = useState([]);
  const [mediaType, setMediaType] = useState(null);
  const [previewItems, setPreviewItems] = useState([]);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const fileInputRef = useRef(null);

  const syncText = (nextValue) => {
    setText(nextValue);
    onTyping?.(nextValue);
  };

  const resetMedia = () => {
    setMediaFiles([]);
    setMediaType(null);
    previewItems.forEach((item) => {
      if (item?.revoke && String(item?.url || "").startsWith("blob:")) {
        URL.revokeObjectURL(item.url);
      }
    });
    setPreviewItems([]);
  };

  const onPickMedia = async (fileList) => {
    const rawFiles = Array.from(fileList || []).filter(Boolean);
    if (!rawFiles.length) return;

    const normalizedFiles = (
      await Promise.all(
        rawFiles.map(async (file) => {
          if (!isHeicLikeFile(file)) return file;
          const convertedFile = await convertHeicFileToJpeg(file);
          if (convertedFile) return convertedFile;
          alert("HEIC image could not be prepared here. Please use JPG/PNG/WebP.");
          return null;
        })
      )
    ).filter(Boolean);

    const files = normalizedFiles;
    if (!files.length) return;
    const allImages = files.every((entry) => String(entry.type || "").toLowerCase().startsWith("image/"));
    const allVideos = files.every((entry) => String(entry.type || "").toLowerCase().startsWith("video/"));

    if (!allImages && !allVideos && files.length !== 1) {
      alert("Only photos can be sent in batches.");
      return;
    }

    if (allImages && files.length > 9) {
      alert("You can send up to 9 photos at once.");
      return;
    }

    if (!allImages && files.length > 1) {
      alert("Please choose one video at a time.");
      return;
    }

    const firstMime = String(files[0]?.type || "").toLowerCase();
    const isImage = firstMime.startsWith("image/");
    const isVideo = firstMime.startsWith("video/");

    if (!isImage && !isVideo) {
      alert("Only photos or videos are allowed here.");
      return;
    }
    resetMedia();
    setMediaFiles(files);
    const nextMediaType = isVideo ? "video" : "image";
    setMediaType(nextMediaType);
    setPreviewItems(buildPreviewItems(files, nextMediaType));
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
        setMediaFiles([file]);
        setMediaType("voice");
        setPreviewItems([{ url: URL.createObjectURL(blob), type: "voice", name: file.name, revoke: true }]);
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
    if (!content && !mediaFiles.length) return;
    const retainedPreviews = mediaFiles.length
      ? mediaFiles.map((file, index) => {
          const currentPreview = previewItems[index]?.url || "";
          return {
            url:
              currentPreview && currentPreview.startsWith("blob:")
                ? URL.createObjectURL(file)
                : currentPreview,
            media_type: mediaType || null,
          };
        })
      : [];
    onSend({
      content,
      mediaFiles,
      mediaType,
      localPreviews: retainedPreviews,
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

      {previewItems.length > 0 && (
        <div className="dm-media-preview">
          {mediaType === "image" && previewItems.length > 1 ? (
            <div className="dm-media-preview-grid">
              {previewItems.map((item, index) => (
                <img key={`${item.url}-${index}`} src={item.url} alt={`preview ${index + 1}`} />
              ))}
            </div>
          ) : mediaType === "image" ? (
            <img src={previewItems[0]?.url} alt="preview" />
          ) : mediaType === "video" ? (
            <video controls playsInline preload="metadata" src={previewItems[0]?.url} />
          ) : (
            <audio controls src={previewItems[0]?.url} />
          )}
          {mediaType === "image" && previewItems.length > 1 ? (
            <div className="dm-media-preview-count">{previewItems.length} photos ready</div>
          ) : null}
          <button type="button" onClick={resetMedia}>Remove</button>
        </div>
      )}

      <div className="chat-input-bar">
        <button type="button" className="chat-icon-btn" onClick={() => fileInputRef.current?.click()} title="Send photo or video">
          🖼️
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            const file = Array.from(e.target.files || []);
            e.target.value = "";
            onPickMedia(file);
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
