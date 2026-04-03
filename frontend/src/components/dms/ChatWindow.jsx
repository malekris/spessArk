import { useCallback, useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { socket } from "../../socket";
import MessageBubble from "./MessageBubble";
import MessageInput from "./MessageInput";
import "./ChatWindow.css";
import { createClientRequestId } from "../../utils/requestId";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";
const DISAPPEARING_OPTIONS = [
  { value: "after_read", label: "After read" },
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
];

const formatLastSeenAgo = (dateString) => {
  if (!dateString) return "";
  const ts = new Date(dateString).getTime();
  if (Number.isNaN(ts)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const getPartnerStatusLabel = (partner) => {
  if (!partner || Number(partner.show_last_active) === 0) return "";
  if (Number(partner.is_online_now) === 1) return "Online";
  if (partner.last_active_at) return `Last seen ${formatLastSeenAgo(partner.last_active_at)}`;
  return "";
};

const isSameDay = (a, b) => {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
};

const formatDayDivider = (dateString) => {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const opts =
    d.getFullYear() === now.getFullYear()
      ? { weekday: "short", month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString("en-US", opts);
};

const getDisappearingLabel = (mode) => {
  if (mode === "1h") return "Disappears in 1 hour";
  if (mode === "24h") return "Disappears in 24 hours";
  return "Disappears after read";
};

const getTempExpiry = (mode) => {
  if (mode === "1h") return new Date(Date.now() + 60 * 60 * 1000).toISOString();
  if (mode === "24h") return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return null;
};

const buildPendingMessageKey = ({ conversationId, receiverId, content, mediaFiles, mediaType, replyToId }) => [
  String(conversationId || "new"),
  String(receiverId || "0"),
  String(content || "").trim(),
  String(mediaType || ""),
  String(replyToId || ""),
  Array.isArray(mediaFiles) && mediaFiles.length
    ? mediaFiles
        .map((mediaFile) => `${mediaFile?.name || ""}:${mediaFile?.size || 0}:${mediaFile?.lastModified || 0}`)
        .join("|")
    : "no-media",
].join("::");

const revokeObjectUrlIfNeeded = (rawUrl) => {
  const asString = String(rawUrl || "").trim();
  if (asString.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(asString);
    } catch {
      // ignore local preview cleanup failures
    }
  }
};

const getDraftMessageLabel = (mediaType, mediaCount = 1) => {
  if (mediaType === "voice") return "Voice note";
  if (mediaType === "image" && mediaCount > 1) return `${mediaCount} photos`;
  if (mediaType === "video") return "Video";
  return "Attachment";
};

const upsertDmMessage = (prevMessages = [], incomingMessage) => {
  if (!incomingMessage) return prevMessages;

  const incomingId = Number(incomingMessage.id || 0);
  const incomingClientRequestId = String(incomingMessage.client_request_id || "").trim();
  let merged = false;
  const next = [];

  for (const message of prevMessages) {
    const sameId =
      incomingId > 0 &&
      Number(message?.id || 0) > 0 &&
      Number(message.id) === incomingId;
    const sameClientRequest =
      incomingClientRequestId &&
      String(message?.client_request_id || "").trim() === incomingClientRequestId;

    if (sameId || sameClientRequest) {
      if (!merged) {
        next.push({ ...message, ...incomingMessage });
        merged = true;
      }
      continue;
    }

    next.push(message);
  }

  if (!merged) {
    next.push(incomingMessage);
  }

  return next;
};

export default function ChatWindow() {
  const { conversationId: routeConversationId, userId: routeReceiverId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const token = localStorage.getItem("vine_token");
  const receiverId = routeReceiverId ? Number(routeReceiverId) : null;
  const [conversationId, setConversationId] = useState(routeConversationId || null);

  const [messages, setMessages] = useState([]);
  const [partner, setPartner] = useState(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [chatSettings, setChatSettings] = useState({
    disappearing_enabled: false,
    disappear_mode: "after_read",
  });
  const [, setLastSeenTick] = useState(0);

  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const typingRef = useRef({ active: false, timeout: null });
  const inFlightMessageKeysRef = useRef(new Set());
  const inFlightRequestIdsRef = useRef(new Map());

  const currentUser = JSON.parse(localStorage.getItem("vine_user"));
  const myId = currentUser?.id;

  const removeMessagesByIds = (ids = []) => {
    const idSet = new Set((ids || []).map((id) => Number(id)).filter(Boolean));
    if (!idSet.size) return;
    setMessages((prev) => prev.filter((m) => !idSet.has(Number(m.id))));
  };

  const markConversationRead = async () => {
    if (!conversationId || !token) return;
    try {
      const res = await fetch(`${API}/api/dms/conversations/${conversationId}/read`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      if (Array.isArray(data?.disappeared_message_ids) && data.disappeared_message_ids.length) {
        removeMessagesByIds(data.disappeared_message_ids);
      }
    } catch {}
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setLastSeenTick((v) => v + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const registerUser = () => {
      if (myId) socket.emit("register", myId);
    };
    if (!socket.connected) socket.connect();
    registerUser();
    socket.on("connect", registerUser);
    return () => {
      socket.off("connect", registerUser);
    };
  }, [myId]);

  useEffect(() => {
    setConversationId(routeConversationId || null);
    stickToBottomRef.current = true;
  }, [routeConversationId]);

  useEffect(() => {
    if (!conversationId) {
      setChatSettings({
        disappearing_enabled: false,
        disappear_mode: "after_read",
      });
      return;
    }

    const loadChatSettings = async () => {
      try {
        const res = await fetch(`${API}/api/dms/conversations/${conversationId}/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        setChatSettings({
          disappearing_enabled: Boolean(data?.disappearing_enabled),
          disappear_mode: data?.disappear_mode || "after_read",
        });
      } catch {}
    };

    loadChatSettings();
  }, [conversationId, token]);

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  /* -----------------------------
     Auto scroll when user is near bottom
  ------------------------------ */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const expiredIds = messages
      .filter((m) => Number(m.is_disappearing) === 1 && m.expires_at)
      .filter((m) => {
        const ts = new Date(m.expires_at).getTime();
        return Number.isFinite(ts) && ts <= Date.now();
      })
      .map((m) => Number(m.id))
      .filter(Boolean);
    if (expiredIds.length) {
      removeMessagesByIds(expiredIds);
    }

    const timers = messages
      .filter((m) => Number(m.is_disappearing) === 1 && m.expires_at)
      .map((m) => {
        const ts = new Date(m.expires_at).getTime();
        if (!Number.isFinite(ts) || ts <= Date.now()) return null;
        return window.setTimeout(() => {
          removeMessagesByIds([m.id]);
        }, ts - Date.now() + 40);
      })
      .filter(Boolean);

    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [messages]);

  /* -----------------------------
     Load messages
  ------------------------------ */
  useEffect(() => {
    if (!conversationId) return;

    const loadMessages = async () => {
      try {
        const res = await fetch(
          `${API}/api/dms/conversations/${conversationId}/messages`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
    
        if (!res.ok) {
          if (res.status === 403) {
            navigate("/vine/dms");
            return;
          }
          throw new Error("Failed to load");
        }
    
        const data = await res.json();
        setMessages(prev => {
          if (!Array.isArray(data)) return prev;
        
          // prevent duplicate echo after optimistic send
          const lastPrevId = prev.at(-1)?.id;
          const lastNewId = data.at(-1)?.id;
        
          if (lastPrevId === lastNewId) return prev;
          return data;
        });
        if (Array.isArray(data) && data.some((m) => Number(m.sender_id) !== Number(myId) && Number(m.is_read) !== 1)) {
          markConversationRead();
        }
        
      } catch (err) {
        console.error("Failed to load messages", err);
      }
    };
     

    loadMessages();
  }, [conversationId]);
  //Handle send messages// 
  const uploadDmMedia = async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API}/api/dms/upload-media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data;
  };

  const handleSendMessage = async (payload) => {
    if (!myId) return;
    if (!conversationId && !receiverId) return;
    stickToBottomRef.current = true;
    const content = String(payload?.content || "").trim();
    const mediaFiles = Array.isArray(payload?.mediaFiles) ? payload.mediaFiles.filter(Boolean) : [];
    const mediaType = payload?.mediaType || null;
    const localPreviewItems = Array.isArray(payload?.localPreviews)
      ? payload.localPreviews.filter((item) => item?.url)
      : [];
    const replyToId = payload?.replyToId || null;
    let uploaded = null;
    if (!content && !mediaFiles.length) return;
    const pendingKey = buildPendingMessageKey({
      conversationId,
      receiverId,
      content,
      mediaFiles,
      mediaType,
      replyToId,
    });
    if (inFlightMessageKeysRef.current.has(pendingKey)) return;
    const clientRequestId =
      inFlightRequestIdsRef.current.get(pendingKey) || createClientRequestId("vine-dm");
    inFlightRequestIdsRef.current.set(pendingKey, clientRequestId);
    inFlightMessageKeysRef.current.add(pendingKey);
  
    const tempId = `temp-${Date.now()}`;
  
    const tempMessage = {
      id: tempId,
      sender_id: myId,
      content: content || getDraftMessageLabel(mediaType, mediaFiles.length),
      created_at: new Date().toISOString(),
      is_disappearing: chatSettings.disappearing_enabled ? 1 : 0,
      disappear_mode: chatSettings.disappear_mode || "after_read",
      expires_at: chatSettings.disappearing_enabled
        ? getTempExpiry(chatSettings.disappear_mode || "after_read")
        : null,
      media_url: localPreviewItems[0]?.url || null,
      media_type: mediaType || null,
      media_items: localPreviewItems.map((item) => ({
        media_url: item.url,
        media_type: item.media_type || mediaType || null,
      })),
      reply_to_id: replyToId || null,
      reply_to_message: replyTarget || null,
      reactions: {},
      viewer_reaction: null,
      client_request_id: clientRequestId,
    };
  
    // 🔥 optimistic UI
    setMessages(prev => [...prev, tempMessage]);
  
    try {
      if (mediaFiles.length) {
        uploaded = await Promise.all(mediaFiles.map((file) => uploadDmMedia(file)));
      }
      const res = await fetch(`${API}/api/dms/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          conversationId
            ? {
                conversationId,
                content,
                media_url: uploaded?.[0]?.url || null,
                media_type: uploaded?.[0]?.media_type || null,
                media_items: Array.isArray(uploaded)
                  ? uploaded.map((item) => ({
                      url: item?.url || null,
                      media_type: item?.media_type || null,
                    }))
                  : [],
                reply_to_id: replyToId || null,
                client_request_id: clientRequestId,
              }
            : {
                receiverId,
                content,
                media_url: uploaded?.[0]?.url || null,
                media_type: uploaded?.[0]?.media_type || null,
                media_items: Array.isArray(uploaded)
                  ? uploaded.map((item) => ({
                      url: item?.url || null,
                      media_type: item?.media_type || null,
                    }))
                  : [],
                reply_to_id: replyToId || null,
                client_request_id: clientRequestId,
              }
        ),
      });
  
      if (!res.ok) throw new Error("Send failed");
  
      const { message: saved, conversationId: savedConversationId } = await res.json();
      if (!conversationId && savedConversationId) {
        setConversationId(savedConversationId);
        navigate(`/vine/dms/${savedConversationId}`, { replace: true });
      }

      // replace optimistic temp or merge with any realtime echo of the same message
      setMessages((prev) =>
        upsertDmMessage(
          prev.map((m) => (m.id === tempId ? { ...m, ...saved, sender_id: myId } : m)),
          { ...saved, sender_id: myId }
        )
      );
      localPreviewItems.forEach((item) => revokeObjectUrlIfNeeded(item?.url));
      inFlightMessageKeysRef.current.delete(pendingKey);
      inFlightRequestIdsRef.current.delete(pendingKey);
      setReplyTarget(null);
    } catch (err) {
      console.error("Send message failed:", err);
      setMessages(prev => prev.filter(m => m.id !== tempId));
      localPreviewItems.forEach((item) => revokeObjectUrlIfNeeded(item?.url));
      inFlightMessageKeysRef.current.delete(pendingKey);
      inFlightRequestIdsRef.current.delete(pendingKey);
    }
  };
  
  
  useEffect(() => {
    if (!socket || !conversationId) return;
  
    const handleSeen = ({ conversationId: cid, seenBy }) => {
      if (String(cid) !== String(conversationId)) return;
      if (Number(seenBy) === Number(myId)) return;
  
      setMessages(prev =>
        prev.map(m =>
          m.sender_id === myId ? { ...m, is_read: 1 } : m
        )
      );
    };
  
    socket.on("messages_seen", handleSeen);
  
    return () => {
      socket.off("messages_seen", handleSeen);
    };
  }, [socket, conversationId, myId]);
  

  /* -----------------------------
     Load chat partner
  ------------------------------ */
  useEffect(() => {
    if (!conversationId) {
      if (receiverId) {
        const params = new URLSearchParams(location.search);
        const username = params.get("username") || `user-${receiverId}`;
        const displayName = params.get("displayName") || username;
        setPartner({
          username,
          display_name: displayName,
          avatar_url: null,
          is_verified: 0,
          show_last_active: 0,
        });
      } else {
        setPartner(null);
      }
      return;
    }

    const loadPartner = async () => {
      try {
        const res = await fetch(`${API}/api/dms/conversations`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const data = await res.json();
        const convo = data.find(
          c => String(c.conversation_id) === String(conversationId)
        );
        if (convo) setPartner(convo);
      } catch (err) {
        console.error("Failed to load partner", err);
      }
    };

    loadPartner();
  }, [conversationId, receiverId, location.search]);

  useEffect(() => {
    if (!conversationId || !token) return;

    let cancelled = false;

    const loadPartnerPresence = async () => {
      try {
        const res = await fetch(`${API}/api/dms/conversations/${conversationId}/presence`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || cancelled) return;
        setPartner((prev) => {
          if (!prev) return data;
          return {
            ...prev,
            ...data,
          };
        });
      } catch {
        // ignore lightweight presence refresh issues
      }
    };

    loadPartnerPresence();
    const interval = setInterval(loadPartnerPresence, 15000);
    const onFocus = () => loadPartnerPresence();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadPartnerPresence();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [conversationId, token]);

  /* -----------------------------
     Socket realtime
  ------------------------------ */
  useEffect(() => {
    if (!conversationId) return;
  
    const user = JSON.parse(localStorage.getItem("vine_user"));
    const myId = user?.id;
  
    // Join room every time conversation changes
    socket.emit("join_conversation", conversationId);
  
    const handleNewMessage = (msg) => {
      if (String(msg.conversation_id) === String(conversationId)) {
        setMessages((prev) => upsertDmMessage(prev, msg));
        if (Number(msg.sender_id) !== Number(myId)) {
          setTimeout(() => {
            markConversationRead();
          }, 120);
        }
      }
    };
  
    const handleSeen = ({ conversationId: seenId, seenBy }) => {
      if (String(seenId) === String(conversationId)) {
        if (Number(seenBy) === Number(myId)) return;
        setMessages(prev =>
          prev.map(m =>
            m.sender_id === myId ? { ...m, is_read: 1 } : m
          )
        );
      }
    };
  
    socket.on("dm_received", handleNewMessage);
    socket.on("messages_seen", handleSeen);
    socket.on("dm_message_deleted", ({ message_id, conversation_id }) => {
      if (String(conversation_id) !== String(conversationId)) return;
      setMessages((prev) => prev.filter((m) => Number(m.id) !== Number(message_id)));
    });
    socket.on("dm_messages_disappeared", ({ conversation_id, message_ids }) => {
      if (String(conversation_id) !== String(conversationId)) return;
      removeMessagesByIds(message_ids);
    });
    socket.on("dm_typing_start", ({ conversationId: cid, userId }) => {
      if (String(cid) !== String(conversationId)) return;
      if (Number(userId) === Number(myId)) return;
      setPartnerTyping(true);
    });
    socket.on("dm_typing_stop", ({ conversationId: cid, userId }) => {
      if (String(cid) !== String(conversationId)) return;
      if (Number(userId) === Number(myId)) return;
      setPartnerTyping(false);
    });
    socket.on("dm_reaction_updated", ({ message_id, reactions, viewer_reaction, actor_id }) => {
      setMessages((prev) =>
        prev.map((m) =>
          Number(m.id) === Number(message_id)
            ? {
                ...m,
                reactions: reactions || {},
                viewer_reaction:
                  Number(actor_id) === Number(myId)
                    ? viewer_reaction || null
                    : m.viewer_reaction || null,
              }
            : m
        )
      );
    });
    socket.on("dm_settings_updated", ({ conversation_id, disappearing_enabled, disappear_mode }) => {
      if (String(conversation_id) !== String(conversationId)) return;
      setChatSettings({
        disappearing_enabled: Boolean(disappearing_enabled),
        disappear_mode: disappear_mode || "after_read",
      });
    });
    socket.on("user_presence_changed", ({ userId, is_online_now, last_active_at }) => {
      setPartner((prev) => {
        if (!prev || Number(prev.user_id) !== Number(userId)) return prev;
        return {
          ...prev,
          is_online_now: is_online_now ? 1 : 0,
          last_active_at: last_active_at || prev.last_active_at,
        };
      });
    });
  
    return () => {
      socket.off("dm_received", handleNewMessage);
      socket.off("messages_seen", handleSeen);
      socket.off("dm_message_deleted");
      socket.off("dm_messages_disappeared");
      socket.off("dm_typing_start");
      socket.off("dm_typing_stop");
      socket.off("dm_reaction_updated");
      socket.off("dm_settings_updated");
      socket.off("user_presence_changed");
    };
  }, [conversationId, myId]);

  useEffect(() => {
    return () => {
      if (typingRef.current.timeout) clearTimeout(typingRef.current.timeout);
    };
  }, []);

  const handleTyping = (value) => {
    if (!conversationId || !myId) return;
    const hasText = String(value || "").length > 0;
    if (hasText && !typingRef.current.active) {
      socket.emit("dm_typing_start", { conversationId, userId: myId });
      typingRef.current.active = true;
    }
    if (typingRef.current.timeout) clearTimeout(typingRef.current.timeout);
    typingRef.current.timeout = setTimeout(() => {
      if (typingRef.current.active) {
        socket.emit("dm_typing_stop", { conversationId, userId: myId });
        typingRef.current.active = false;
      }
    }, 1200);
    if (!hasText && typingRef.current.active) {
      socket.emit("dm_typing_stop", { conversationId, userId: myId });
      typingRef.current.active = false;
    }
  };

  const handleReply = useCallback((message) => {
    setReplyTarget(message);
  }, []);

  const handleReact = useCallback(async (message, reaction) => {
    try {
      const res = await fetch(`${API}/api/dms/messages/${message.id}/reaction`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reaction }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setMessages((prev) =>
        prev.map((m) =>
          Number(m.id) === Number(message.id)
            ? {
                ...m,
                reactions: data.reactions || {},
                viewer_reaction: data.viewer_reaction || null,
              }
            : m
        )
      );
    } catch {}
  }, [token]);

  const handleDeleteMessage = useCallback(async (message) => {
    if (!message?.id || String(message.id).startsWith("temp-")) return;
    if (!window.confirm("Delete this message?")) return;
    try {
      const res = await fetch(`${API}/api/dms/messages/${message.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      setMessages((prev) => prev.filter((m) => Number(m.id) !== Number(message.id)));
    } catch {}
  }, [token]);

  const saveDisappearingSettings = async (nextEnabled, nextMode = chatSettings.disappear_mode) => {
    if (!conversationId || settingsSaving) return;
    setSettingsSaving(true);
    try {
      const res = await fetch(`${API}/api/dms/conversations/${conversationId}/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          disappearing_enabled: nextEnabled,
          disappear_mode: nextMode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Failed to update chat settings");
        return;
      }
      setChatSettings({
        disappearing_enabled: Boolean(data?.disappearing_enabled),
        disappear_mode: data?.disappear_mode || "after_read",
      });
    } catch {
      alert("Failed to update chat settings");
    } finally {
      setSettingsSaving(false);
    }
  };

  const toggleDisappearingMessages = async () => {
    await saveDisappearingSettings(
      !chatSettings.disappearing_enabled,
      chatSettings.disappear_mode || "after_read"
    );
  };

  const selectDisappearingMode = async (mode) => {
    if (!conversationId || settingsSaving) return;
    if (mode === chatSettings.disappear_mode && chatSettings.disappearing_enabled) return;
    await saveDisappearingSettings(true, mode);
  };
  
  /* -----------------------------
     UI
  ------------------------------ */
  return (
    <div className="vine-chat-wrapper">

      {/* HEADER */}
      <div className="chat-header">
        <button
          className="dm-chat-back"
          onClick={() => navigate("/vine/dms")}
          aria-label="Back to messages"
          title="Back to messages"
        >
          <span className="dm-chat-back-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path
                d="M14.5 6.5L9 12l5.5 5.5"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="dm-chat-back-label">Messages</span>
        </button>

        {partner ? (
          <div
            className="chat-user"
            onClick={() => setProfileSheetOpen(true)}
          >
            <img
              src={
                partner.avatar_url
                  ? (partner.avatar_url.startsWith("http")
                      ? partner.avatar_url
                      : `${API}${partner.avatar_url}`)
                  : DEFAULT_AVATAR
              }
              alt=""
              className="chat-avatar"
              onError={(e) => {
                e.currentTarget.src = DEFAULT_AVATAR;
              }}
            />

            <div className="chat-header-meta">
              <strong
                className="chat-name"
                onClick={(e) => {
                  e.stopPropagation();
                  setProfileSheetOpen(true);
                }}
              >
                <span>{partner.display_name || partner.username}</span>
                {(Number(partner.is_verified) === 1 || ["vine guardian","vine_guardian","vine news","vine_news"].includes(String(partner.username || "").toLowerCase())) && (
                  <span className={`verified ${["vine guardian","vine_guardian","vine news","vine_news"].includes(String(partner.username || "").toLowerCase()) ? "guardian" : ""}`}>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none">
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
              </strong>
              <div className="chat-status-stack">
                {getPartnerStatusLabel(partner) && (
                  <div className={`chat-lastseen ${Number(partner?.is_online_now) === 1 ? "online" : ""}`}>
                    {getPartnerStatusLabel(partner)}
                  </div>
                )}
                {chatSettings.disappearing_enabled && (
                  <div className="chat-vanish-pill">{getDisappearingLabel(chatSettings.disappear_mode)}</div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ opacity: 0.6 }}>Loading chat…</div>
        )}
      </div>

      {chatSettings.disappearing_enabled && (
        <div className="chat-vanish-banner">
          <strong>Vanish mode:</strong> {getDisappearingLabel(chatSettings.disappear_mode)}.
          <span> Messages disappear for both people and screenshots can still be taken.</span>
        </div>
      )}

      {/* MESSAGES */}
            <div
              className="messages-container"
              ref={scrollRef}
              onScroll={() => {
                stickToBottomRef.current = isNearBottom();
              }}
            >
        {messages.length === 0 ? (
          <div className="chat-empty">Start of your Vine history 🌱</div>
        ) : (
          messages.map((m, i) => {
            const prev = i > 0 ? messages[i - 1] : null;
            const showDayDivider = !prev || !isSameDay(prev.created_at, m.created_at);

            return (
              <div key={`${m.id}-${m.sender_id}-${i}`}>
                {showDayDivider && (
                  <div className="chat-day-divider">
                    <span>{formatDayDivider(m.created_at)}</span>
                  </div>
                )}
                <MessageBubble
                  message={m}
                  onReply={handleReply}
                  onReact={handleReact}
                  onDelete={handleDeleteMessage}
                />
              </div>
            );
          })
          
        )}
          </div>


      {/* INPUT */}
      <div className="chat-footer">
        {partnerTyping && (
          <div
            className="chat-typing-pill chat-typing-pill-footer"
            aria-live="polite"
            aria-label={`${partner.display_name || partner.username || "Someone"} is typing`}
          >
            <span className="chat-typing-bubble" aria-hidden="true">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
            </span>
            <span className="chat-typing-label">{partner.display_name || partner.username || "Someone"} is typing…</span>
          </div>
        )}
        <MessageInput
          onSend={handleSendMessage}
          replyTarget={replyTarget}
          onCancelReply={() => setReplyTarget(null)}
          onTyping={handleTyping}
        />
      </div>

      {profileSheetOpen && partner && (
        <div className="dm-profile-sheet-backdrop" onClick={() => setProfileSheetOpen(false)}>
          <div className="dm-profile-sheet" onClick={(e) => e.stopPropagation()}>
            <button
              className="dm-profile-sheet-close"
              type="button"
              onClick={() => setProfileSheetOpen(false)}
            >
              ✕
            </button>

            <div className="dm-profile-sheet-user">
              <img
                src={
                  partner.avatar_url
                    ? (partner.avatar_url.startsWith("http")
                        ? partner.avatar_url
                        : `${API}${partner.avatar_url}`)
                    : DEFAULT_AVATAR
                }
                alt=""
                className="dm-profile-sheet-avatar"
                onError={(e) => {
                  e.currentTarget.src = DEFAULT_AVATAR;
                }}
              />
              <div className="dm-profile-sheet-meta">
                <div className="dm-profile-sheet-name">
                  <span>{partner.display_name || partner.username}</span>
                  {(Number(partner.is_verified) === 1 || ["vine guardian","vine_guardian","vine news","vine_news"].includes(String(partner.username || "").toLowerCase())) && (
                    <span className={`verified ${["vine guardian","vine_guardian","vine news","vine_news"].includes(String(partner.username || "").toLowerCase()) ? "guardian" : ""}`}>
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none">
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
                <div className="dm-profile-sheet-username">@{partner.username}</div>
                {getPartnerStatusLabel(partner) && (
                  <div className={`dm-profile-sheet-status ${Number(partner?.is_online_now) === 1 ? "online" : ""}`}>
                    {getPartnerStatusLabel(partner)}
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              className="dm-profile-sheet-main-btn"
              onClick={() => {
                setProfileSheetOpen(false);
                navigate(`/vine/profile/${partner.username}`);
              }}
            >
              View full profile
            </button>

            <div className="dm-profile-setting-card">
              <div>
                <div className="dm-profile-setting-title">Disappearing messages</div>
                <div className="dm-profile-setting-copy">
                  New messages in this chat vanish for both people using the timer you choose below.
                </div>
              </div>
              <button
                type="button"
                className={`dm-disappearing-toggle ${chatSettings.disappearing_enabled ? "on" : ""}`}
                disabled={!conversationId || settingsSaving}
                onClick={toggleDisappearingMessages}
              >
                <span className="dm-disappearing-toggle-knob" />
              </button>
            </div>

            <div className="dm-disappearing-modes">
              {DISAPPEARING_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`dm-disappearing-mode-btn ${
                    chatSettings.disappear_mode === option.value ? "active" : ""
                  }`}
                  disabled={!conversationId || settingsSaving || !chatSettings.disappearing_enabled}
                  onClick={() => selectDisappearingMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="dm-profile-sheet-note">
              Screenshots, copied text, or camera photos of the screen can still be saved by the other person.
            </div>

            {!conversationId && (
              <div className="dm-profile-sheet-note dm-profile-sheet-note-secondary">
                Send the first message in this chat to unlock disappearing mode.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
