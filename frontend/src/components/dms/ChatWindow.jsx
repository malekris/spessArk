import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { socket } from "../../socket";
import MessageBubble from "./MessageBubble";
import MessageInput from "./MessageInput";
import GroupDetailsSheet from "./GroupDetailsSheet";
import DirectSharedMedia from "./DirectSharedMedia";
import DirectChatPet from "./DirectChatPet";
import { CHAT_THEMES, normalizeChatTheme } from "./chatThemes";
import { buildGroupSenderStyles } from "./groupSenderColors";
import "./ChatWindow.css";
import { createClientRequestId } from "../../utils/requestId";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";
const DISAPPEARING_OPTIONS = [
  { value: "after_read", label: "After read" },
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
];
const QUICK_EMOJIS = ["👍", "❤️", "😂", "🔥", "🌱", "💯"];
const DEFAULT_DIRECT_VIEW_PREFERENCES = {
  alwaysShowTimestamps: false,
  bubbleDensity: "comfortable",
};
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

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

const canGroupMessages = (first, second) => {
  if (!first || !second) return false;
  if (String(first.message_type || "").toLowerCase() === "call") return false;
  if (String(second.message_type || "").toLowerCase() === "call") return false;
  if (String(first.message_type || "").toLowerCase() === "system") return false;
  if (String(second.message_type || "").toLowerCase() === "system") return false;
  if (Number(first.sender_id) !== Number(second.sender_id)) return false;
  if (!isSameDay(first.created_at, second.created_at)) return false;

  const firstTime = new Date(first.created_at).getTime();
  const secondTime = new Date(second.created_at).getTime();
  if (Number.isNaN(firstTime) || Number.isNaN(secondTime)) return false;
  return Math.abs(secondTime - firstTime) <= 5 * 60 * 1000;
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

const normalizeQuickEmoji = (value) =>
  QUICK_EMOJIS.includes(String(value || "").trim()) ? String(value).trim() : "👍";

const normalizeChatNickname = (value) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, 32);

const normalizeChatNicknames = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([userId, nickname]) => [String(Number(userId)), normalizeChatNickname(nickname)])
      .filter(([userId, nickname]) => userId !== "0" && Boolean(nickname))
  );
};

const getDirectViewPreferenceKey = (firstUserId, secondUserId) => {
  const ids = [Number(firstUserId), Number(secondUserId)].filter(Boolean).sort((a, b) => a - b);
  return ids.length === 2 ? `vine_dm_view_preferences_${ids[0]}_${ids[1]}` : "";
};

const readDirectViewPreferences = (key) => {
  if (!key) return DEFAULT_DIRECT_VIEW_PREFERENCES;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "{}");
    return {
      alwaysShowTimestamps: Boolean(stored.alwaysShowTimestamps),
      bubbleDensity: stored.bubbleDensity === "compact" ? "compact" : "comfortable",
    };
  } catch {
    return DEFAULT_DIRECT_VIEW_PREFERENCES;
  }
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

export default function ChatWindow({
  conversationId: conversationIdProp = null,
  receiverId: receiverIdProp = null,
  compact = false,
  onClose = null,
  onMinimize = null,
  initialPartner = null,
}) {
  const { conversationId: routeConversationId, userId: routeReceiverId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const token = localStorage.getItem("vine_token");
  const receiverId = receiverIdProp ? Number(receiverIdProp) : (routeReceiverId ? Number(routeReceiverId) : null);
  const [conversationId, setConversationId] = useState(conversationIdProp || routeConversationId || null);

  const [messages, setMessages] = useState([]);
  const [partner, setPartner] = useState(initialPartner || null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [chatSettings, setChatSettings] = useState({
    disappearing_enabled: false,
    disappear_mode: "after_read",
    theme_color: "vine",
    quick_emoji: "👍",
    nicknames: {},
  });
  const [chatPet, setChatPet] = useState(null);
  const [directViewPreferences, setDirectViewPreferences] = useState(DEFAULT_DIRECT_VIEW_PREFERENCES);
  const [nicknameDrafts, setNicknameDrafts] = useState({});
  const [callState, setCallState] = useState("idle");
  const [callNotice, setCallNotice] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [, setLastSeenTick] = useState(0);

  const scrollRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const typingRef = useRef({ active: false, timeout: null });
  const inFlightMessageKeysRef = useRef(new Set());
  const inFlightRequestIdsRef = useRef(new Map());
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const callIdRef = useRef(null);
  const callStateRef = useRef("idle");

  const currentUser = JSON.parse(localStorage.getItem("vine_user"));
  const myId = currentUser?.id;
  const partnerUserId = Number(partner?.user_id || partner?.id || receiverId || 0);
  const isGroup = partner?.conversation_type === "group";
  const groupMemberKey = isGroup ? (partner.member_ids || [...new Set(messages.map((message) => Number(message.sender_id)))]).join(",") : "";
  const senderStyles = useMemo(() => buildGroupSenderStyles(groupMemberKey.split(",")), [groupMemberKey]);
  const latestMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (String(messages[index]?.message_type || "").toLowerCase() !== "system") {
        return messages[index];
      }
    }
    return null;
  }, [messages]);
  const latestUnansweredOwnMessageId =
    Number(latestMessage?.sender_id) === Number(myId)
      ? String(latestMessage.id)
      : null;
  const memberRoles = isGroup ? (partner?.member_roles || {}) : {};
  const groupTheme = normalizeChatTheme(partner?.theme_color);
  const directTheme = normalizeChatTheme(chatSettings.theme_color);
  const directViewPreferenceKey = getDirectViewPreferenceKey(myId, partnerUserId);
  const partnerChatName = !isGroup
    ? chatSettings.nicknames?.[String(partnerUserId)] || partner?.display_name || partner?.username
    : partner?.display_name || partner?.username;
  const nicknameDraftsChanged = !isGroup && [myId, partnerUserId]
    .map((userId) => String(Number(userId || 0)))
    .filter((userId) => userId !== "0")
    .some((userId) => normalizeChatNickname(nicknameDrafts[userId]) !== String(chatSettings.nicknames?.[userId] || ""));

  const setCallStatus = (nextState, notice = "") => {
    callStateRef.current = nextState;
    setCallState(nextState);
    setCallNotice(notice);
  };

  const stopLocalCallStream = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
  };

  const resetCall = (notice = "") => {
    if (peerRef.current) {
      try {
        peerRef.current.close();
      } catch {}
      peerRef.current = null;
    }
    stopLocalCallStream();
    callIdRef.current = null;
    setIncomingCall(null);
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setCallStatus("idle", notice);
  };

  const createPeerConnection = (callId) => {
    if (peerRef.current) {
      try {
        peerRef.current.close();
      } catch {}
    }
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerRef.current = pc;
    pc.onicecandidate = (event) => {
      if (!event.candidate || !conversationId || !callId) return;
      socket.emit("dm_call_signal", {
        conversationId,
        callId,
        fromUserId: myId,
        candidate: event.candidate,
      });
    };
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams || [];
      if (remoteAudioRef.current && remoteStream) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.play?.().catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(pc.connectionState)) {
        setCallStatus("idle", "Call disconnected");
        resetCall("Call disconnected");
      }
    };
    return pc;
  };

  const getLocalAudioStream = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Audio calls are not supported on this browser.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    localStreamRef.current = stream;
    return stream;
  };

  const startAudioCall = async () => {
    if (window.__vineCallLayerActive) {
      window.dispatchEvent(new CustomEvent("vine:start-audio-call", {
        detail: {
          conversationId,
          toUserId: partnerUserId,
          partner,
        },
      }));
      return;
    }
    if (!conversationId) {
      setCallNotice("Send the first message before starting a call.");
      return;
    }
    if (!partnerUserId || isGroup || callState !== "idle") return;
    const callId = `${conversationId}-${myId}-${Date.now()}`;
    callIdRef.current = callId;
    setCallStatus("outgoing", "Calling...");
    try {
      const pc = createPeerConnection(callId);
      const stream = await getLocalAudioStream();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("dm_call_invite", {
        conversationId,
        callId,
        fromUserId: myId,
        toUserId: partnerUserId,
        offer,
      });
    } catch (err) {
      resetCall(err?.message || "Could not start audio call.");
    }
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall || !conversationId) return;
    const callId = incomingCall.callId;
    callIdRef.current = callId;
    setCallStatus("connecting", "Connecting...");
    try {
      const pc = createPeerConnection(callId);
      const stream = await getLocalAudioStream();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("dm_call_accept", {
        conversationId,
        callId,
        fromUserId: myId,
        answer,
      });
      setIncomingCall(null);
      setCallStatus("active", "Audio call connected");
    } catch (err) {
      socket.emit("dm_call_end", { conversationId, callId, fromUserId: myId });
      resetCall(err?.message || "Could not answer audio call.");
    }
  };

  const declineIncomingCall = () => {
    if (incomingCall?.callId && conversationId) {
      socket.emit("dm_call_decline", {
        conversationId,
        callId: incomingCall.callId,
        fromUserId: myId,
      });
    }
    resetCall("Call declined");
  };

  const endAudioCall = () => {
    const callId = callIdRef.current || incomingCall?.callId;
    if (conversationId && callId) {
      socket.emit("dm_call_end", { conversationId, callId, fromUserId: myId });
    }
    resetCall("Call ended");
  };

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
    setConversationId(conversationIdProp || routeConversationId || null);
    stickToBottomRef.current = true;
  }, [conversationIdProp, routeConversationId]);

  useEffect(() => {
    if (!conversationId) {
      setChatSettings({
        disappearing_enabled: false,
        disappear_mode: "after_read",
        theme_color: "vine",
        quick_emoji: "👍",
        nicknames: {},
      });
      setNicknameDrafts({});
      return;
    }

    const loadChatSettings = async () => {
      try {
        const res = await fetch(`${API}/api/dms/conversations/${conversationId}/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const nextNicknames = normalizeChatNicknames(data?.nicknames);
        setChatSettings({
          disappearing_enabled: Boolean(data?.disappearing_enabled),
          disappear_mode: data?.disappear_mode || "after_read",
          theme_color: normalizeChatTheme(data?.theme_color),
          quick_emoji: normalizeQuickEmoji(data?.quick_emoji),
          nicknames: nextNicknames,
        });
        setNicknameDrafts(nextNicknames);
      } catch {}
    };

    loadChatSettings();
  }, [conversationId, token]);

  const loadChatPet = useCallback(async () => {
    if (!conversationId || !token || isGroup) {
      setChatPet(null);
      return;
    }
    try {
      const response = await fetch(`${API}/api/dms/conversations/${conversationId}/pet`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setChatPet(data);
    } catch {
      // Retried when the chat or settings sheet is opened again.
    }
  }, [conversationId, isGroup, token]);

  useEffect(() => {
    loadChatPet();
  }, [loadChatPet]);

  useEffect(() => {
    if (isGroup || !directViewPreferenceKey) {
      setDirectViewPreferences(DEFAULT_DIRECT_VIEW_PREFERENCES);
      return;
    }
    setDirectViewPreferences(readDirectViewPreferences(directViewPreferenceKey));
  }, [directViewPreferenceKey, isGroup]);

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
            if (!compact) {
              navigate("/vine/dms");
            }
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
  }, [compact, conversationId, myId, navigate, token]);
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
        if (!compact) {
          navigate(`/vine/dms/${savedConversationId}`, { replace: true });
        }
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
      if (chatPet?.adopted) loadChatPet();
    } catch (err) {
      console.error("Send message failed:", err);
      setMessages(prev => prev.filter(m => m.id !== tempId));
      localPreviewItems.forEach((item) => revokeObjectUrlIfNeeded(item?.url));
      inFlightMessageKeysRef.current.delete(pendingKey);
      inFlightRequestIdsRef.current.delete(pendingKey);
    }
  };
  
  
  /* -----------------------------
     Load chat partner
  ------------------------------ */
  useEffect(() => {
    if (!conversationId) {
      if (receiverId) {
        const params = new URLSearchParams(location.search);
        const username = initialPartner?.username || params.get("username") || `user-${receiverId}`;
        const displayName = initialPartner?.display_name || params.get("displayName") || username;
        setPartner({
          ...(initialPartner || {}),
          id: Number(initialPartner?.id || receiverId),
          user_id: Number(initialPartner?.user_id || initialPartner?.id || receiverId),
          username,
          display_name: displayName,
          avatar_url: initialPartner?.avatar_url || null,
          is_verified: Number(initialPartner?.is_verified || 0),
          show_last_active: Number(initialPartner?.show_last_active || 0),
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
        if (convo) {
          setPartner((current) => ({
            ...convo,
            ...(String(current?.conversation_id) === String(conversationId) && current?.member_ids
              ? {
                  member_ids: current.member_ids,
                  member_roles: current.member_roles,
                  theme_color: current.theme_color,
                  notifications_muted: current.notifications_muted,
                  group_description: current.group_description,
                }
              : {}),
          }));
        }
      } catch (err) {
        console.error("Failed to load partner", err);
      }
    };

    loadPartner();
  }, [conversationId, receiverId, location.search, initialPartner]);

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
          return {
            ...prev,
            ...data,
            conversation_id: Number(conversationId),
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
  
    const handleSeen = ({ conversationId: seenId, seenBy, group, lastReadMessageId, seenByUser }) => {
      if (String(seenId) === String(conversationId)) {
        if (Number(seenBy) === Number(myId)) return;
        if (group || isGroup) {
          const receiptUser = seenByUser?.user_id
            ? seenByUser
            : { user_id: Number(seenBy), display_name: "Group member", username: "" };
          const readThroughId = Number(lastReadMessageId || 0);
          if (!readThroughId) return;
          setMessages((prev) =>
            prev.map((message) => {
              if (
                Number(message.id || 0) > readThroughId ||
                Number(message.sender_id) !== Number(myId)
              ) {
                return message;
              }
              const existing = Array.isArray(message.seen_by) ? message.seen_by : [];
              if (existing.some((member) => Number(member.user_id) === Number(seenBy))) return message;
              return { ...message, seen_by: [...existing, receiptUser] };
            })
          );
          return;
        }
        setMessages(prev =>
          prev.map(m =>
            m.sender_id === myId ? { ...m, is_read: 1 } : m
          )
        );
      }
    };
    const handleGroupUpdated = async ({ conversation_id }) => {
      if (String(conversation_id) !== String(conversationId)) return;
      try {
        const response = await fetch(`${API}/api/dms/conversations/${conversationId}/presence`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await response.json().catch(() => null);
        if (response.ok && data) setPartner((current) => ({ ...(current || {}), ...data }));
      } catch {
        // The regular presence refresh will retry.
      }
    };
  
    socket.on("dm_received", handleNewMessage);
    socket.on("messages_seen", handleSeen);
    socket.on("dm_group_updated", handleGroupUpdated);
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
    socket.on("dm_settings_updated", ({ conversation_id, disappearing_enabled, disappear_mode, theme_color, quick_emoji, nicknames }) => {
      if (String(conversation_id) !== String(conversationId)) return;
      const nextNicknames = normalizeChatNicknames(nicknames);
      setChatSettings({
        disappearing_enabled: Boolean(disappearing_enabled),
        disappear_mode: disappear_mode || "after_read",
        theme_color: normalizeChatTheme(theme_color),
        quick_emoji: normalizeQuickEmoji(quick_emoji),
        nicknames: nextNicknames,
      });
      setNicknameDrafts(nextNicknames);
    });
    socket.on("dm_pet_updated", ({ conversation_id, ...nextPet }) => {
      if (String(conversation_id) !== String(conversationId)) return;
      setChatPet(nextPet);
    });
    socket.on("dm_group_removed", ({ conversation_id }) => {
      if (String(conversation_id) !== String(conversationId)) return;
      setProfileSheetOpen(false);
      if (compact) onClose?.();
      else navigate("/vine/dms");
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
    socket.on("dm_call_invite", (payload = {}) => {
      if (window.__vineCallLayerActive) return;
      if (String(payload.conversationId) !== String(conversationId)) return;
      if (Number(payload.fromUserId) === Number(myId)) return;
      if (payload.toUserId && Number(payload.toUserId) !== Number(myId)) return;
      if (!payload.callId || !payload.offer) return;
      if (callStateRef.current !== "idle") {
        socket.emit("dm_call_decline", {
          conversationId,
          callId: payload.callId,
          fromUserId: myId,
          reason: "busy",
        });
        return;
      }
      callIdRef.current = payload.callId;
      setIncomingCall(payload);
      setCallStatus("incoming", "Incoming audio call");
    });
    socket.on("dm_call_accept", async (payload = {}) => {
      if (window.__vineCallLayerActive) return;
      if (String(payload.conversationId) !== String(conversationId)) return;
      if (payload.callId !== callIdRef.current || !payload.answer || !peerRef.current) return;
      try {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
        setCallStatus("active", "Audio call connected");
      } catch {
        resetCall("Call connection failed");
      }
    });
    socket.on("dm_call_decline", (payload = {}) => {
      if (window.__vineCallLayerActive) return;
      if (String(payload.conversationId) !== String(conversationId)) return;
      if (payload.callId !== callIdRef.current) return;
      resetCall(payload.reason === "busy" ? "User is already on a call" : "Call declined");
    });
    socket.on("dm_call_end", (payload = {}) => {
      if (window.__vineCallLayerActive) return;
      if (String(payload.conversationId) !== String(conversationId)) return;
      if (payload.callId !== callIdRef.current) return;
      resetCall("Call ended");
    });
    socket.on("dm_call_signal", async (payload = {}) => {
      if (window.__vineCallLayerActive) return;
      if (String(payload.conversationId) !== String(conversationId)) return;
      if (payload.callId !== callIdRef.current || !payload.candidate || !peerRef.current) return;
      try {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch {
        // ICE candidates can arrive during teardown; ignore late candidates.
      }
    });
  
    return () => {
      socket.off("dm_received", handleNewMessage);
      socket.off("messages_seen", handleSeen);
      socket.off("dm_group_updated", handleGroupUpdated);
      socket.off("dm_message_deleted");
      socket.off("dm_messages_disappeared");
      socket.off("dm_typing_start");
      socket.off("dm_typing_stop");
      socket.off("dm_reaction_updated");
      socket.off("dm_settings_updated");
      socket.off("dm_pet_updated");
      socket.off("dm_group_removed");
      socket.off("user_presence_changed");
      socket.off("dm_call_invite");
      socket.off("dm_call_accept");
      socket.off("dm_call_decline");
      socket.off("dm_call_end");
      socket.off("dm_call_signal");
    };
  }, [conversationId, isGroup, myId]);

  useEffect(() => {
    return () => {
      if (typingRef.current.timeout) clearTimeout(typingRef.current.timeout);
      if (callIdRef.current && conversationId) {
        socket.emit("dm_call_end", {
          conversationId,
          callId: callIdRef.current,
          fromUserId: myId,
        });
      }
      resetCall();
    };
  }, [conversationId, myId]);

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
    if (isGroup) {
      setReplyTarget(message);
      return;
    }
    const nickname = chatSettings.nicknames?.[String(Number(message?.sender_id || 0))];
    setReplyTarget(nickname ? { ...message, display_name: nickname } : message);
  }, [chatSettings.nicknames, isGroup]);

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
    const deletingAnotherGroupMessage = isGroup && Number(message.sender_id) !== Number(myId);
    if (!window.confirm(deletingAnotherGroupMessage ? "Permanently delete this message for everyone?" : "Delete this message?")) return;
    try {
      const res = await fetch(`${API}/api/dms/messages/${message.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      setMessages((prev) => prev.filter((m) => Number(m.id) !== Number(message.id)));
    } catch {}
  }, [isGroup, myId, token]);

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
      const nextNicknames = normalizeChatNicknames(data?.nicknames);
      setChatSettings({
        disappearing_enabled: Boolean(data?.disappearing_enabled),
        disappear_mode: data?.disappear_mode || "after_read",
        theme_color: normalizeChatTheme(data?.theme_color),
        quick_emoji: normalizeQuickEmoji(data?.quick_emoji),
        nicknames: nextNicknames,
      });
      setNicknameDrafts(nextNicknames);
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

  const selectDirectTheme = async (themeColor) => {
    const nextTheme = normalizeChatTheme(themeColor);
    if (!conversationId || settingsSaving || nextTheme === directTheme) return;
    setSettingsSaving(true);
    try {
      const res = await fetch(`${API}/api/dms/conversations/${conversationId}/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ theme_color: nextTheme }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Failed to update chat theme");
        return;
      }
      const nextNicknames = normalizeChatNicknames(data?.nicknames);
      setChatSettings({
        disappearing_enabled: Boolean(data?.disappearing_enabled),
        disappear_mode: data?.disappear_mode || "after_read",
        theme_color: normalizeChatTheme(data?.theme_color),
        quick_emoji: normalizeQuickEmoji(data?.quick_emoji),
        nicknames: nextNicknames,
      });
      setNicknameDrafts(nextNicknames);
    } catch {
      alert("Failed to update chat theme");
    } finally {
      setSettingsSaving(false);
    }
  };

  const selectQuickEmoji = async (emoji) => {
    const nextEmoji = normalizeQuickEmoji(emoji);
    if (!conversationId || settingsSaving || nextEmoji === chatSettings.quick_emoji) return;
    setSettingsSaving(true);
    try {
      const res = await fetch(`${API}/api/dms/conversations/${conversationId}/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ quick_emoji: nextEmoji }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Failed to update the quick emoji");
        return;
      }
      const nextNicknames = normalizeChatNicknames(data?.nicknames);
      setChatSettings({
        disappearing_enabled: Boolean(data?.disappearing_enabled),
        disappear_mode: data?.disappear_mode || "after_read",
        theme_color: normalizeChatTheme(data?.theme_color),
        quick_emoji: normalizeQuickEmoji(data?.quick_emoji),
        nicknames: nextNicknames,
      });
      setNicknameDrafts(nextNicknames);
    } catch {
      alert("Failed to update the quick emoji");
    } finally {
      setSettingsSaving(false);
    }
  };

  const saveChatNicknames = async () => {
    if (!conversationId || !partnerUserId || !myId || settingsSaving) return;
    const nextNicknames = {
      [String(myId)]: normalizeChatNickname(nicknameDrafts[String(myId)]),
      [String(partnerUserId)]: normalizeChatNickname(nicknameDrafts[String(partnerUserId)]),
    };
    setSettingsSaving(true);
    try {
      const res = await fetch(`${API}/api/dms/conversations/${conversationId}/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ nicknames: nextNicknames }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Failed to update chat nicknames");
        return;
      }
      const savedNicknames = normalizeChatNicknames(data?.nicknames);
      setChatSettings({
        disappearing_enabled: Boolean(data?.disappearing_enabled),
        disappear_mode: data?.disappear_mode || "after_read",
        theme_color: normalizeChatTheme(data?.theme_color),
        quick_emoji: normalizeQuickEmoji(data?.quick_emoji),
        nicknames: savedNicknames,
      });
      setNicknameDrafts(savedNicknames);
    } catch {
      alert("Failed to update chat nicknames");
    } finally {
      setSettingsSaving(false);
    }
  };

  const updateDirectViewPreference = (patch) => {
    const nextPreferences = { ...directViewPreferences, ...patch };
    setDirectViewPreferences(nextPreferences);
    if (!directViewPreferenceKey) return;
    try {
      localStorage.setItem(directViewPreferenceKey, JSON.stringify(nextPreferences));
    } catch {
      // Keep the preference for this session when browser storage is unavailable.
    }
  };
  
  /* -----------------------------
     UI
  ------------------------------ */
  return (
    <div
      className={`vine-chat-wrapper ${compact ? "chat-window-compact" : ""} ${isGroup ? "dm-group-chat" : "dm-direct-chat"}`}
      data-group-theme={isGroup ? groupTheme : undefined}
      data-chat-theme={!isGroup ? directTheme : undefined}
      data-bubble-density={!isGroup ? directViewPreferences.bubbleDensity : undefined}
    >

      {/* HEADER */}
      <div className="chat-header">
        {!compact && (
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
        )}

        {partner ? (
          <div
            className="chat-user"
            onClick={() => setProfileSheetOpen(true)}
          >
            {isGroup && (partner.group_avatar_url || partner.avatar_url) ? (
              <img
                src={
                  String(partner.group_avatar_url || partner.avatar_url).startsWith("http")
                    ? (partner.group_avatar_url || partner.avatar_url)
                    : `${API}${partner.group_avatar_url || partner.avatar_url}`
                }
                alt=""
                className="chat-avatar dm-chat-group-photo"
                onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }}
              />
            ) : isGroup ? (
              <div className="chat-avatar dm-chat-group-avatar" aria-hidden="true">
                {String(partner.group_name || partner.display_name || "G").slice(0, 2).toUpperCase()}
              </div>
            ) : (
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
            )}

            <div className="chat-header-meta">
              <strong
                className="chat-name"
                onClick={(e) => {
                  e.stopPropagation();
                  setProfileSheetOpen(true);
                }}
              >
                <span>{isGroup ? partner.display_name || partner.username : partnerChatName}</span>
                {!isGroup && (Number(partner.is_verified) === 1 || ["vine guardian","vine_guardian","vine news","vine_news"].includes(String(partner.username || "").toLowerCase())) && (
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
                {isGroup ? (
                  <div className="chat-lastseen dm-chat-group-count">{Number(partner.member_count || 0)} members</div>
                ) : getPartnerStatusLabel(partner) ? (
                  <div className={`chat-lastseen ${Number(partner?.is_online_now) === 1 ? "online" : ""}`}>
                    {getPartnerStatusLabel(partner)}
                  </div>
                ) : null}
                {!isGroup && chatSettings.disappearing_enabled && (
                  <div className="chat-vanish-pill">{getDisappearingLabel(chatSettings.disappear_mode)}</div>
                )}
                {!isGroup && chatPet?.adopted && (
                  <div className="chat-pet-pill">{chatPet?.stage?.emoji || "🌱"} {chatPet.pet_name}</div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ opacity: 0.6 }}>Loading chat…</div>
        )}

        {isGroup && (
          <button
            type="button"
            className="dm-group-details-button"
            onClick={() => setProfileSheetOpen(true)}
            aria-label="Group settings"
            title="Group settings"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="19" cy="12" r="1.6" fill="currentColor" />
            </svg>
          </button>
        )}
        {!isGroup && <div className="dm-call-actions">
          {["outgoing", "connecting", "active"].includes(callState) ? (
            <button
              type="button"
              className="dm-call-btn dm-call-btn-end"
              onClick={endAudioCall}
              aria-label="End audio call"
              title="End audio call"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path d="M5 15.5c4.4-3 9.6-3 14 0" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M7.5 14.4l-1.1 2.8a1 1 0 0 0 .72 1.34l2.15.48a1 1 0 0 0 1.16-.72l.48-1.86" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M16.5 14.4l1.1 2.8a1 1 0 0 1-.72 1.34l-2.15.48a1 1 0 0 1-1.16-.72l-.48-1.86" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="dm-call-btn"
              onClick={startAudioCall}
              disabled={!conversationId || !partnerUserId || callState !== "idle"}
              aria-label="Start audio call"
              title={conversationId ? "Start audio call" : "Send a message first to start calls"}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path
                  d="M8.4 4.8 10 8.4a1.6 1.6 0 0 1-.38 1.82l-1.1 1.1a12.2 12.2 0 0 0 4.16 4.16l1.1-1.1A1.6 1.6 0 0 1 15.6 14l3.6 1.6a1.6 1.6 0 0 1 .94 1.76l-.42 2.08A1.9 1.9 0 0 1 17.86 21C9.65 21 3 14.35 3 6.14A1.9 1.9 0 0 1 4.56 4.28l2.08-.42A1.6 1.6 0 0 1 8.4 4.8Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="dm-direct-details-button"
            onClick={() => setProfileSheetOpen(true)}
            aria-label="Chat settings"
            title="Chat settings"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="19" cy="12" r="1.6" fill="currentColor" />
            </svg>
          </button>
        </div>}

        {compact && (onMinimize || onClose) && (
          <div className="dm-chat-window-actions">
            {onMinimize && (
              <button
                type="button"
                className="dm-chat-window-btn"
                onClick={onMinimize}
                aria-label="Minimize chat window"
                title="Minimize chat window"
              >
                −
              </button>
            )}
            {onClose && (
              <button
                type="button"
                className="dm-chat-close dm-chat-window-btn"
                onClick={onClose}
                aria-label="Close chat window"
                title="Close chat window"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      <audio ref={remoteAudioRef} autoPlay playsInline />

      {callState !== "idle" && (
        <div className={`dm-call-banner ${callState}`}>
          <div>
            <strong>
              {callState === "incoming"
                ? "Incoming audio call"
                : callState === "active"
                  ? "Audio call live"
                  : callState === "outgoing"
                    ? "Calling..."
                    : "Connecting..."}
            </strong>
            <span>{callNotice || (partner ? partnerChatName : "Vine call")}</span>
          </div>
          {callState === "incoming" ? (
            <div className="dm-call-banner-actions">
              <button type="button" className="dm-call-answer" onClick={acceptIncomingCall}>
                Answer
              </button>
              <button type="button" className="dm-call-decline" onClick={declineIncomingCall}>
                Decline
              </button>
            </div>
          ) : (
            <button type="button" className="dm-call-decline" onClick={endAudioCall}>
              End
            </button>
          )}
        </div>
      )}

      {callState === "idle" && callNotice && (
        <div className="dm-call-toast">{callNotice}</div>
      )}

      {!isGroup && chatSettings.disappearing_enabled && (
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
            const next = i < messages.length - 1 ? messages[i + 1] : null;
            const showDayDivider = !prev || !isSameDay(prev.created_at, m.created_at);
            const joinsPrevious = canGroupMessages(prev, m);
            const joinsNext = canGroupMessages(m, next);
            const groupPosition = joinsPrevious
              ? joinsNext
                ? "middle"
                : "last"
              : joinsNext
                ? "first"
                : "single";

            return (
              <div key={`${m.id}-${m.sender_id}-${i}`}>
                {showDayDivider && (
                  <div className="chat-day-divider">
                    <span>{formatDayDivider(m.created_at)}</span>
                  </div>
                )}
                <MessageBubble
                  message={m}
                  isGroup={isGroup}
                  senderStyle={senderStyles[m.sender_id]}
                  senderRole={memberRoles[m.sender_id] || memberRoles[String(m.sender_id)] || "member"}
                  groupPosition={groupPosition}
                  showMeta={!joinsNext || (!isGroup && directViewPreferences.alwaysShowTimestamps)}
                  showDeliveryStatus={
                    latestUnansweredOwnMessageId !== null &&
                    String(m.id) === latestUnansweredOwnMessageId
                  }
                  nicknames={isGroup ? undefined : chatSettings.nicknames}
                  canModerate={isGroup && ["owner", "admin"].includes(partner?.viewer_role)}
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
            aria-label={`${isGroup ? "Someone" : partnerChatName || "Someone"} is typing`}
          >
            <span className="chat-typing-bubble" aria-hidden="true">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
            </span>
            <span className="chat-typing-label">{isGroup ? "Someone" : partnerChatName || "Someone"} is typing…</span>
          </div>
        )}
        <MessageInput
          onSend={handleSendMessage}
          quickEmoji={isGroup ? "" : chatSettings.quick_emoji}
          replyTarget={replyTarget}
          onCancelReply={() => setReplyTarget(null)}
          onTyping={handleTyping}
        />
      </div>

      {profileSheetOpen && partner && !isGroup && (
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

            <DirectChatPet
              conversationId={conversationId}
              token={token}
              pet={chatPet}
              onUpdated={setChatPet}
            />

            <section className="dm-direct-nickname-setting" aria-labelledby="dm-direct-nickname-title">
              <div>
                <div id="dm-direct-nickname-title" className="dm-profile-setting-title">Chat nicknames</div>
                <div className="dm-profile-setting-copy">
                  Shared by both of you. Leave a name blank to use the person’s profile name.
                </div>
              </div>
              <div className="dm-direct-nickname-fields">
                <label>
                  <span><strong>{currentUser?.display_name || currentUser?.username || "You"}</strong><small>You</small></span>
                  <input
                    type="text"
                    value={nicknameDrafts[String(myId)] || ""}
                    onChange={(event) => setNicknameDrafts((current) => ({ ...current, [String(myId)]: event.target.value.slice(0, 32) }))}
                    placeholder="Add your nickname"
                    maxLength={32}
                    disabled={!conversationId || settingsSaving}
                  />
                </label>
                <label>
                  <span><strong>{partner.display_name || partner.username}</strong><small>@{partner.username}</small></span>
                  <input
                    type="text"
                    value={nicknameDrafts[String(partnerUserId)] || ""}
                    onChange={(event) => setNicknameDrafts((current) => ({ ...current, [String(partnerUserId)]: event.target.value.slice(0, 32) }))}
                    placeholder={`Nickname for ${partner.display_name || partner.username}`}
                    maxLength={32}
                    disabled={!conversationId || settingsSaving}
                  />
                </label>
              </div>
              <button
                type="button"
                className="dm-direct-nickname-save"
                onClick={saveChatNicknames}
                disabled={!conversationId || !myId || settingsSaving || !nicknameDraftsChanged}
              >
                {settingsSaving ? "Saving…" : "Save nicknames"}
              </button>
            </section>

            <section className="dm-direct-theme-setting" aria-labelledby="dm-direct-theme-title">
              <div>
                <div id="dm-direct-theme-title" className="dm-profile-setting-title">Chat theme</div>
                <div className="dm-profile-setting-copy">
                  Shared by both of you. A note appears in the chat whenever either person changes it.
                </div>
              </div>
              <div className="dm-direct-theme-swatches" role="radiogroup" aria-label="Chat theme">
                {CHAT_THEMES.map((theme) => (
                  <button
                    key={theme.value}
                    type="button"
                    className={directTheme === theme.value ? "active" : ""}
                    onClick={() => selectDirectTheme(theme.value)}
                    disabled={!conversationId || settingsSaving}
                    role="radio"
                    aria-checked={directTheme === theme.value}
                    aria-label={`${theme.label} theme`}
                    title={theme.label}
                  >
                    <span style={{ backgroundColor: theme.color }} />
                    <small>{theme.label}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="dm-direct-quick-emoji-setting" aria-labelledby="dm-direct-quick-emoji-title">
              <div>
                <div id="dm-direct-quick-emoji-title" className="dm-profile-setting-title">Quick emoji</div>
                <div className="dm-profile-setting-copy">
                  Shared by both of you. Tap it beside the message box to send it instantly.
                </div>
              </div>
              <div className="dm-direct-quick-emojis" role="radiogroup" aria-label="Quick emoji">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={chatSettings.quick_emoji === emoji ? "active" : ""}
                    onClick={() => selectQuickEmoji(emoji)}
                    disabled={!conversationId || settingsSaving}
                    role="radio"
                    aria-checked={chatSettings.quick_emoji === emoji}
                    aria-label={`Use ${emoji} as the quick emoji`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </section>

            <section className="dm-direct-display-setting" aria-labelledby="dm-direct-display-title">
              <div id="dm-direct-display-title" className="dm-profile-setting-title">Chat display</div>
              <div className="dm-direct-display-row">
                <span><strong>Always show timestamps</strong><small>Show the time below every message.</small></span>
                <button
                  type="button"
                  className={`dm-setting-toggle ${directViewPreferences.alwaysShowTimestamps ? "on" : ""}`}
                  onClick={() => updateDirectViewPreference({ alwaysShowTimestamps: !directViewPreferences.alwaysShowTimestamps })}
                  role="switch"
                  aria-checked={directViewPreferences.alwaysShowTimestamps}
                  aria-label="Always show timestamps"
                >
                  <span />
                </button>
              </div>
              <div className="dm-direct-density-row">
                <span><strong>Message spacing</strong><small>Only changes how this chat looks for you.</small></span>
                <div className="dm-direct-density-options" role="radiogroup" aria-label="Message spacing">
                  {["comfortable", "compact"].map((density) => (
                    <button
                      key={density}
                      type="button"
                      className={directViewPreferences.bubbleDensity === density ? "active" : ""}
                      onClick={() => updateDirectViewPreference({ bubbleDensity: density })}
                      role="radio"
                      aria-checked={directViewPreferences.bubbleDensity === density}
                    >
                      {density === "comfortable" ? "Comfortable" : "Compact"}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <DirectSharedMedia conversationId={conversationId} token={token} nicknames={chatSettings.nicknames} />

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
      <GroupDetailsSheet
        open={Boolean(profileSheetOpen && partner && isGroup)}
        conversationId={conversationId}
        onClose={() => setProfileSheetOpen(false)}
        onChanged={(group) => {
          setPartner((current) => ({
            ...(current || {}),
            conversation_type: "group",
            group_name: group.group_name,
            username: group.group_name,
            display_name: group.group_name,
            member_count: group.member_count,
            viewer_role: group.viewer_role,
            group_avatar_url: group.group_avatar_url,
            member_ids: group.members?.map((member) => member.user_id),
            member_roles: Object.fromEntries((group.members || []).map((member) => [Number(member.user_id), member.role])),
            group_description: group.group_description,
            notifications_muted: group.notifications_muted,
            theme_color: group.theme_color,
            avatar_url: group.group_avatar_url,
          }));
        }}
        onLeft={() => {
          setProfileSheetOpen(false);
          navigate("/vine/dms");
        }}
        onDeleted={() => {
          setProfileSheetOpen(false);
          if (compact) onClose?.();
          else navigate("/vine/dms");
        }}
      />
    </div>
  );
}
