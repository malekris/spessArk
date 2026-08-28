import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../../../socket";
import "./VineEClass.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";
const TURN_URLS = String(import.meta.env.VITE_TURN_URLS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const TURN_USERNAME = String(import.meta.env.VITE_TURN_USERNAME || "").trim();
const TURN_CREDENTIAL = String(import.meta.env.VITE_TURN_CREDENTIAL || "").trim();
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    ...(TURN_URLS.length
      ? [{
          urls: TURN_URLS,
          ...(TURN_USERNAME && TURN_CREDENTIAL
            ? { username: TURN_USERNAME, credential: TURN_CREDENTIAL }
            : {}),
        }]
      : []),
  ],
  iceCandidatePoolSize: 10,
};

const toMediaUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_AVATAR;
  return raw.startsWith("http") ? raw : `${API}${raw}`;
};

const formatClassDuration = (startedAt, nowMs) => {
  const started = new Date(startedAt || 0).getTime();
  if (!started || Number.isNaN(started)) return "0:00";
  const seconds = Math.max(0, Math.floor((nowMs - started) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
};

const formatClassDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const emitWithAck = (eventName, payload, timeoutMs = 12000) =>
  new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, message: "Vine eClass did not respond in time" });
    }, timeoutMs);
    socket.emit(eventName, payload, (response = {}) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(response);
    });
  });

const waitForSocket = (userId) =>
  new Promise((resolve, reject) => {
    if (socket.connected) {
      socket.emit("register", userId);
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      socket.off("connect", handleConnect);
      reject(new Error("Vine realtime connection is unavailable"));
    }, 10000);
    const handleConnect = () => {
      window.clearTimeout(timer);
      socket.emit("register", userId);
      resolve();
    };
    socket.once("connect", handleConnect);
    socket.connect();
  });

export default function VineEClass({
  community,
  token,
  currentUser,
  initialSession = null,
  onSessionChange,
}) {
  const communityId = Number(community?.id || 0);
  const myId = Number(currentUser?.id || 0);
  const role = String(community?.viewer_role || "").toLowerCase();
  const canModerate = ["owner", "moderator"].includes(role);
  const [liveSession, setLiveSession] = useState(initialSession);
  const [history, setHistory] = useState([]);
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [selfMuted, setSelfMuted] = useState(true);
  const [hostMuted, setHostMuted] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteScreen, setRemoteScreen] = useState(null);
  const [localScreen, setLocalScreen] = useState(null);
  const [remoteAudioStreams, setRemoteAudioStreams] = useState({});
  const [chatText, setChatText] = useState("");
  const [startTitle, setStartTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [panelTab, setPanelTab] = useState("chat");
  const [notice, setNotice] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());

  const liveSessionRef = useRef(liveSession);
  const joinedRef = useRef(joined);
  const localAudioRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const localScreenVideoRef = useRef(null);
  const remoteScreenVideoRef = useRef(null);
  const chatFeedRef = useRef(null);
  const chatInputRef = useRef(null);

  useEffect(() => {
    liveSessionRef.current = liveSession;
  }, [liveSession]);

  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);

  useEffect(() => {
    setLiveSession(initialSession || null);
  }, [initialSession]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = localScreen;
  }, [localScreen]);

  useEffect(() => {
    if (remoteScreenVideoRef.current) remoteScreenVideoRef.current.srcObject = remoteScreen?.stream || null;
  }, [remoteScreen]);

  useEffect(() => {
    const feed = chatFeedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const input = chatInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
  }, [chatText]);

  const updateSession = useCallback((session) => {
    const nextSession = session || null;
    liveSessionRef.current = nextSession;
    setLiveSession(nextSession);
    onSessionChange?.(nextSession);
  }, [onSessionChange]);

  const mergeParticipant = useCallback((participant) => {
    if (!participant?.user_id) return;
    setParticipants((previous) => {
      const exists = previous.some((entry) => Number(entry.user_id) === Number(participant.user_id));
      return exists
        ? previous.map((entry) => Number(entry.user_id) === Number(participant.user_id) ? { ...entry, ...participant } : entry)
        : [...previous, participant];
    });
  }, []);

  const stopMediaAndPeers = useCallback(() => {
    for (const pc of peerConnectionsRef.current.values()) {
      try {
        pc.close();
      } catch {
        // Closing an already-finished peer is harmless.
      }
    }
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localAudioRef.current?.getTracks().forEach((track) => track.stop());
    localAudioRef.current = null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setLocalScreen(null);
    setRemoteScreen(null);
    setRemoteAudioStreams({});
    setScreenSharing(false);
  }, []);

  const leaveClass = useCallback(async ({ notifyServer = true } = {}) => {
    const sessionId = Number(liveSessionRef.current?.id || 0);
    if (notifyServer && sessionId && joinedRef.current) {
      socket.emit("eclass_leave", { sessionId });
    }
    stopMediaAndPeers();
    setJoined(false);
    setParticipants([]);
    setSelfMuted(true);
    setHostMuted(false);
    setHandRaised(false);
  }, [stopMediaAndPeers]);

  const sendSignal = useCallback((targetUserId, payload) => {
    const sessionId = Number(liveSessionRef.current?.id || 0);
    if (!sessionId || !targetUserId) return;
    socket.emit("eclass_signal", {
      sessionId,
      targetUserId: Number(targetUserId),
      ...payload,
    });
  }, []);

  const flushCandidates = useCallback(async (remoteUserId, pc) => {
    const pending = pendingCandidatesRef.current.get(Number(remoteUserId)) || [];
    pendingCandidatesRef.current.delete(Number(remoteUserId));
    for (const candidate of pending) {
      if (pc.signalingState === "closed") return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Superseded ICE paths can be ignored during renegotiation.
      }
    }
  }, []);

  const createPeerConnection = useCallback((remoteUserId) => {
    const uid = Number(remoteUserId);
    const existing = peerConnectionsRef.current.get(uid);
    if (existing && existing.signalingState !== "closed") return existing;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnectionsRef.current.set(uid, pc);

    localAudioRef.current?.getAudioTracks().forEach((track) => {
      pc.addTrack(track, localAudioRef.current);
    });
    screenStreamRef.current?.getVideoTracks().forEach((track) => {
      pc.addTrack(track, screenStreamRef.current);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(uid, { candidate: event.candidate });
    };
    pc.ontrack = (event) => {
      const stream = event.streams?.[0] || (event.track ? new MediaStream([event.track]) : null);
      if (!stream) return;
      if (event.track.kind === "video") {
        setRemoteScreen({ userId: uid, stream });
        event.track.onended = () => {
          setRemoteScreen((current) => Number(current?.userId) === uid ? null : current);
        };
        return;
      }
      setRemoteAudioStreams((previous) => ({ ...previous, [uid]: stream }));
    };
    const handleConnectionState = () => {
      if (!["failed", "closed"].includes(pc.connectionState)) return;
      if (peerConnectionsRef.current.get(uid) === pc) peerConnectionsRef.current.delete(uid);
      setRemoteAudioStreams((previous) => {
        const next = { ...previous };
        delete next[uid];
        return next;
      });
    };
    pc.onconnectionstatechange = handleConnectionState;
    return pc;
  }, [sendSignal]);

  const makeOffer = useCallback(async (remoteUserId) => {
    const pc = createPeerConnection(remoteUserId);
    if (pc.signalingState !== "stable") return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(remoteUserId, { description: pc.localDescription });
    } catch (err) {
      console.warn("Vine eClass negotiation failed:", err?.message || err);
    }
  }, [createPeerConnection, sendSignal]);

  const handleSignal = useCallback(async (payload = {}) => {
    if (Number(payload.sessionId) !== Number(liveSessionRef.current?.id) || Number(payload.targetUserId) !== myId) return;
    const remoteUserId = Number(payload.fromUserId);
    if (!remoteUserId) return;
    const pc = createPeerConnection(remoteUserId);
    try {
      if (payload.description) {
        const description = new RTCSessionDescription(payload.description);
        if (description.type === "offer") {
          if (pc.signalingState !== "stable") {
            await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
          }
          await pc.setRemoteDescription(description);
          await flushCandidates(remoteUserId, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal(remoteUserId, { description: pc.localDescription });
        } else if (description.type === "answer" && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(description);
          await flushCandidates(remoteUserId, pc);
        }
      }
      if (payload.candidate) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } else {
          const pending = pendingCandidatesRef.current.get(remoteUserId) || [];
          pending.push(payload.candidate);
          pendingCandidatesRef.current.set(remoteUserId, pending);
        }
      }
    } catch (err) {
      console.warn("Vine eClass signal could not be applied:", err?.message || err);
    }
  }, [createPeerConnection, flushCandidates, myId, sendSignal]);

  const loadClass = useCallback(async () => {
    if (!communityId || !token) return;
    try {
      const [liveResponse, historyResponse] = await Promise.all([
        fetch(`${API}/api/vine/communities/${communityId}/eclass/live`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`${API}/api/vine/communities/${communityId}/eclass/history`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);
      const liveData = await liveResponse.json().catch(() => ({}));
      const historyData = await historyResponse.json().catch(() => []);
      if (liveResponse.ok) {
        updateSession(liveData.session || null);
        setMessages(Array.isArray(liveData.messages) ? liveData.messages : []);
      }
      if (historyResponse.ok) setHistory(Array.isArray(historyData) ? historyData : []);
    } catch {
      setNotice("Vine eClass could not be refreshed.");
    }
  }, [communityId, token, updateSession]);

  useEffect(() => {
    void loadClass();
  }, [loadClass]);

  useEffect(() => {
    const handleStarted = (payload = {}) => {
      if (Number(payload.community_id || payload.communityId) !== communityId) return;
      updateSession(payload.session || payload);
      setNotice("A Vine eClass is live now.");
    };
    const handleEnded = (payload = {}) => {
      if (Number(payload.sessionId) !== Number(liveSessionRef.current?.id)) return;
      void leaveClass({ notifyServer: false });
      updateSession(null);
      setNotice("This Vine eClass has ended.");
      void loadClass();
    };
    const handleParticipantJoined = ({ sessionId, participant } = {}) => {
      if (Number(sessionId) !== Number(liveSessionRef.current?.id)) return;
      mergeParticipant(participant);
    };
    const handleParticipantLeft = ({ sessionId, userId } = {}) => {
      if (Number(sessionId) !== Number(liveSessionRef.current?.id)) return;
      const uid = Number(userId);
      setParticipants((previous) => previous.filter((entry) => Number(entry.user_id) !== uid));
      const pc = peerConnectionsRef.current.get(uid);
      if (pc) pc.close();
      peerConnectionsRef.current.delete(uid);
      setRemoteAudioStreams((previous) => {
        const next = { ...previous };
        delete next[uid];
        return next;
      });
      setRemoteScreen((current) => Number(current?.userId) === uid ? null : current);
    };
    const handleChat = (message) => {
      if (Number(message?.session_id) !== Number(liveSessionRef.current?.id)) return;
      setMessages((previous) => previous.some((entry) => Number(entry.id) === Number(message.id)) ? previous : [...previous, message]);
    };
    const handleAudioState = ({ sessionId, userId, muted } = {}) => {
      if (Number(sessionId) !== Number(liveSessionRef.current?.id)) return;
      setParticipants((previous) => previous.map((entry) => Number(entry.user_id) === Number(userId)
        ? { ...entry, is_self_muted: muted ? 1 : 0 }
        : entry));
    };
    const handleModeratedMute = ({ sessionId, userId, muted } = {}) => {
      if (Number(sessionId) !== Number(liveSessionRef.current?.id)) return;
      setParticipants((previous) => previous.map((entry) => Number(entry.user_id) === Number(userId)
        ? { ...entry, is_muted_by_host: muted ? 1 : 0, ...(muted ? { is_self_muted: 1 } : {}) }
        : entry));
      if (Number(userId) !== myId) return;
      setHostMuted(Boolean(muted));
      if (muted) {
        setSelfMuted(true);
        localAudioRef.current?.getAudioTracks().forEach((track) => { track.enabled = false; });
        setNotice("A moderator muted your microphone.");
      } else {
        setNotice("The moderator released your microphone. You can unmute when ready.");
      }
    };
    const handleRaisedHand = ({ sessionId, userId, raised } = {}) => {
      if (Number(sessionId) !== Number(liveSessionRef.current?.id)) return;
      setParticipants((previous) => previous.map((entry) => Number(entry.user_id) === Number(userId)
        ? { ...entry, hand_raised: raised ? 1 : 0 }
        : entry));
    };
    const handleScreenState = ({ sessionId, userId, sharing } = {}) => {
      if (Number(sessionId) !== Number(liveSessionRef.current?.id)) return;
      if (!sharing) setRemoteScreen((current) => Number(current?.userId) === Number(userId) ? null : current);
    };

    socket.on("eclass_started", handleStarted);
    socket.on("eclass_ended", handleEnded);
    socket.on("eclass_participant_joined", handleParticipantJoined);
    socket.on("eclass_participant_left", handleParticipantLeft);
    socket.on("eclass_signal", handleSignal);
    socket.on("eclass_chat", handleChat);
    socket.on("eclass_audio_state", handleAudioState);
    socket.on("eclass_moderated_mute", handleModeratedMute);
    socket.on("eclass_raise_hand", handleRaisedHand);
    socket.on("eclass_screen_state", handleScreenState);
    return () => {
      socket.off("eclass_started", handleStarted);
      socket.off("eclass_ended", handleEnded);
      socket.off("eclass_participant_joined", handleParticipantJoined);
      socket.off("eclass_participant_left", handleParticipantLeft);
      socket.off("eclass_signal", handleSignal);
      socket.off("eclass_chat", handleChat);
      socket.off("eclass_audio_state", handleAudioState);
      socket.off("eclass_moderated_mute", handleModeratedMute);
      socket.off("eclass_raise_hand", handleRaisedHand);
      socket.off("eclass_screen_state", handleScreenState);
    };
  }, [communityId, handleSignal, leaveClass, loadClass, mergeParticipant, myId, updateSession]);

  useEffect(() => () => {
    if (joinedRef.current && liveSessionRef.current?.id) {
      socket.emit("eclass_leave", { sessionId: liveSessionRef.current.id });
    }
    stopMediaAndPeers();
  }, [stopMediaAndPeers]);

  const joinClass = async (sessionOverride = null) => {
    const session = sessionOverride || liveSessionRef.current;
    if (!session?.id || joinedRef.current || joining) return;
    setJoining(true);
    setNotice("");
    try {
      await waitForSocket(myId);
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Audio classes are not supported by this browser");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      localAudioRef.current = stream;
      const response = await emitWithAck("eclass_join", {
        sessionId: Number(session.id),
        communityId,
        token,
      });
      if (!response?.ok) throw new Error(response?.message || "Could not join Vine eClass");
      const self = response.self || {};
      const mutedOnEntry = Number(self.is_self_muted || 0) === 1 || Number(self.is_muted_by_host || 0) === 1;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !mutedOnEntry;
        if ("contentHint" in track) track.contentHint = "speech";
      });
      setSelfMuted(mutedOnEntry);
      setHostMuted(Number(self.is_muted_by_host || 0) === 1);
      setHandRaised(Number(self.hand_raised || 0) === 1);
      const existing = Array.isArray(response.participants) ? response.participants : [];
      setParticipants([self, ...existing].filter((entry) => entry?.user_id));
      setJoined(true);
      joinedRef.current = true;
      for (const participant of existing) await makeOffer(participant.user_id);
    } catch (err) {
      localAudioRef.current?.getTracks().forEach((track) => track.stop());
      localAudioRef.current = null;
      setNotice(err?.message || "Could not join Vine eClass");
    } finally {
      setJoining(false);
    }
  };

  const startClass = async () => {
    if (!canModerate || starting) return;
    setStarting(true);
    setNotice("");
    try {
      const response = await fetch(`${API}/api/vine/communities/${communityId}/eclass/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: startTitle.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 409) throw new Error(data.message || "Could not start Vine eClass");
      const session = data.session;
      if (!session?.id) throw new Error(data.message || "Could not start Vine eClass");
      updateSession(session);
      setMessages([]);
      setStartTitle("");
      if (response.status === 409) setNotice("The existing live class has been opened.");
      await joinClass(session);
    } catch (err) {
      setNotice(err?.message || "Could not start Vine eClass");
    } finally {
      setStarting(false);
    }
  };

  const endClass = async () => {
    if (!liveSession?.id || !canModerate || ending) return;
    setEnding(true);
    try {
      const response = await fetch(
        `${API}/api/vine/communities/${communityId}/eclass/sessions/${liveSession.id}/end`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not end Vine eClass");
      setShowEndConfirm(false);
      await leaveClass({ notifyServer: false });
      updateSession(null);
      setNotice("Vine eClass ended for everyone.");
      await loadClass();
    } catch (err) {
      setNotice(err?.message || "Could not end Vine eClass");
    } finally {
      setEnding(false);
    }
  };

  const toggleSelfMute = async () => {
    if (!joined || !liveSession?.id) return;
    if (hostMuted && selfMuted) {
      setNotice("A moderator has muted your microphone.");
      return;
    }
    const nextMuted = !selfMuted;
    const response = await emitWithAck("eclass_audio_state", {
      sessionId: liveSession.id,
      muted: nextMuted,
    });
    if (!response?.ok) {
      setNotice(response?.message || "Microphone could not be changed");
      return;
    }
    setSelfMuted(nextMuted);
    localAudioRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
  };

  const toggleHand = async () => {
    if (!joined || !liveSession?.id) return;
    const raised = !handRaised;
    const response = await emitWithAck("eclass_raise_hand", { sessionId: liveSession.id, raised });
    if (response?.ok) setHandRaised(raised);
  };

  const moderateMute = async (participant) => {
    if (!canModerate || !liveSession?.id) return;
    const nextMuted = Number(participant.is_muted_by_host || 0) !== 1;
    const response = await emitWithAck("eclass_moderate_mute", {
      sessionId: liveSession.id,
      targetUserId: participant.user_id,
      muted: nextMuted,
    });
    if (!response?.ok) setNotice(response?.message || "Microphone control failed");
  };

  const stopScreenShare = useCallback(async () => {
    const stream = screenStreamRef.current;
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    screenStreamRef.current = null;
    setLocalScreen(null);
    setScreenSharing(false);
    for (const [userId, pc] of peerConnectionsRef.current.entries()) {
      for (const sender of pc.getSenders()) {
        if (sender.track && tracks.includes(sender.track)) pc.removeTrack(sender);
      }
      void makeOffer(userId);
    }
    tracks.forEach((track) => track.stop());
    if (liveSessionRef.current?.id) {
      socket.emit("eclass_screen_state", { sessionId: liveSessionRef.current.id, sharing: false });
    }
  }, [makeOffer]);

  const startScreenShare = async () => {
    if (!canModerate || !joined || screenSharing) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice("Screen sharing is not supported on this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const [track] = stream.getVideoTracks();
      if (!track) throw new Error("No screen was selected");
      screenStreamRef.current = stream;
      setLocalScreen(stream);
      setScreenSharing(true);
      for (const [userId, pc] of peerConnectionsRef.current.entries()) {
        pc.addTrack(track, stream);
        void makeOffer(userId);
      }
      socket.emit("eclass_screen_state", { sessionId: liveSession.id, sharing: true });
      track.onended = () => { void stopScreenShare(); };
    } catch (err) {
      if (String(err?.name || "") !== "NotAllowedError") {
        setNotice(err?.message || "Screen sharing could not start");
      }
    }
  };

  const sendChat = async () => {
    const content = chatText.trim();
    if (!content || !joined || !liveSession?.id) return;
    setChatText("");
    const response = await emitWithAck("eclass_chat", { sessionId: liveSession.id, content });
    if (!response?.ok) {
      setChatText(content);
      setNotice(response?.message || "Message could not be sent");
    }
  };

  const sortedParticipants = useMemo(() => [...participants].sort((a, b) => {
    const aRole = ["owner", "moderator"].includes(String(a.community_role || "").toLowerCase()) ? 0 : 1;
    const bRole = ["owner", "moderator"].includes(String(b.community_role || "").toLowerCase()) ? 0 : 1;
    if (aRole !== bRole) return aRole - bRole;
    if (Number(a.hand_raised || 0) !== Number(b.hand_raised || 0)) return Number(b.hand_raised || 0) - Number(a.hand_raised || 0);
    return String(a.display_name || a.username || "").localeCompare(String(b.display_name || b.username || ""));
  }), [participants]);
  const hostParticipant = sortedParticipants.find((participant) => Number(participant.user_id) === Number(liveSession?.host_user_id));
  const activeScreen = localScreen || remoteScreen?.stream || null;

  return (
    <section className="eclass-shell" aria-label="Vine eClass">
      <header className="eclass-heading">
        <div>
          <span className="eclass-eyebrow">Live learning on Vine</span>
          <h3>Vine eClass</h3>
          <p>{community?.name || "Community"} live classroom</p>
        </div>
        {liveSession ? (
          <div className="eclass-live-pill"><i /> Live now</div>
        ) : (
          <div className="eclass-offline-pill">No class live</div>
        )}
      </header>

      {notice ? (
        <div className="eclass-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice">×</button>
        </div>
      ) : null}

      {!liveSession ? (
        <div className="eclass-lobby">
          <div className="eclass-lobby-copy">
            <span className="eclass-lobby-mark" aria-hidden="true">V</span>
            <div>
              <h4>The classroom is quiet</h4>
              <p>No live lesson is running in {community?.name || "this community"} right now.</p>
            </div>
          </div>
          {canModerate ? (
            <div className="eclass-start-panel">
              <label htmlFor="eclass-title">Class topic</label>
              <div className="eclass-start-row">
                <input
                  id="eclass-title"
                  value={startTitle}
                  maxLength={180}
                  onChange={(event) => setStartTitle(event.target.value)}
                  placeholder={`${community?.name || "Community"} live lesson`}
                />
                <button type="button" onClick={startClass} disabled={starting}>
                  {starting ? "Starting..." : "Start eClass"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : !joined ? (
        <div className="eclass-prejoin">
          <div className="eclass-prejoin-visual">
            <div className="eclass-host-avatar-wrap">
              <img src={toMediaUrl(liveSession.host_avatar_url)} alt="" />
              <span className="eclass-host-live-dot" />
            </div>
            <span className="eclass-prejoin-kicker">Live from {community?.name}</span>
            <h4>{liveSession.title}</h4>
            <p>{liveSession.host_display_name || liveSession.host_username} is hosting this community lesson.</p>
            <div className="eclass-prejoin-meta">
              <span>Live {formatClassDuration(liveSession.started_at, nowMs)}</span>
              <span>Audio class</span>
              <span>Member only</span>
            </div>
          </div>
          <button type="button" className="eclass-join-btn" onClick={() => joinClass()} disabled={joining}>
            {joining ? "Joining securely..." : "Join Vine eClass"}
          </button>
          <small>Your microphone starts muted. You can unmute when you are ready to speak.</small>
        </div>
      ) : (
        <div className="eclass-room">
          <div className="eclass-main-column">
            <div className={`eclass-stage ${activeScreen ? "is-sharing" : ""}`}>
              <div className="eclass-stage-topline">
                <div>
                  <span className="eclass-stage-live"><i /> LIVE</span>
                  <strong>{liveSession.title}</strong>
                </div>
                <span>{formatClassDuration(liveSession.started_at, nowMs)}</span>
              </div>

              {activeScreen ? (
                <div className="eclass-screen-canvas">
                  {localScreen ? (
                    <video ref={localScreenVideoRef} autoPlay playsInline muted />
                  ) : (
                    <video ref={remoteScreenVideoRef} autoPlay playsInline />
                  )}
                  <span>{localScreen ? "You are presenting" : "Moderator screen"}</span>
                </div>
              ) : (
                <div className="eclass-audio-stage">
                  <div className="eclass-audio-rings" aria-hidden="true"><i /><i /><i /></div>
                  <img
                    className="eclass-featured-avatar"
                    src={toMediaUrl(hostParticipant?.avatar_url || liveSession.host_avatar_url)}
                    alt=""
                  />
                  <span className="eclass-speaking-label">Class hosted by</span>
                  <strong>{hostParticipant?.display_name || liveSession.host_display_name || liveSession.host_username}</strong>
                  <p>{sortedParticipants.length} {sortedParticipants.length === 1 ? "participant" : "participants"} connected</p>
                </div>
              )}

              <div className="eclass-participant-strip">
                {sortedParticipants.slice(0, 8).map((participant) => {
                  const muted = Number(participant.is_self_muted || 0) === 1 || Number(participant.is_muted_by_host || 0) === 1;
                  return (
                    <div className="eclass-mini-person" key={`mini-${participant.user_id}`}>
                      <div>
                        <img src={toMediaUrl(participant.avatar_url)} alt="" />
                        <span className={muted ? "is-muted" : "is-open"} title={muted ? "Microphone muted" : "Microphone on"}>
                          {muted ? "×" : "•"}
                        </span>
                      </div>
                      <small>{Number(participant.user_id) === myId ? "You" : participant.display_name || participant.username}</small>
                    </div>
                  );
                })}
                {sortedParticipants.length > 8 ? <div className="eclass-more-people">+{sortedParticipants.length - 8}</div> : null}
              </div>
            </div>

            <div className="eclass-controls" aria-label="Class controls">
              <button
                type="button"
                className={selfMuted ? "is-off" : "is-on"}
                onClick={toggleSelfMute}
                title={selfMuted ? "Unmute microphone" : "Mute microphone"}
              >
                <span aria-hidden="true">{selfMuted ? "×" : "•"}</span>
                {selfMuted ? "Unmute" : "Mute"}
              </button>
              <button type="button" className={handRaised ? "is-raised" : ""} onClick={toggleHand}>
                <span aria-hidden="true">↑</span>
                {handRaised ? "Lower hand" : "Raise hand"}
              </button>
              {canModerate ? (
                <button
                  type="button"
                  className={screenSharing ? "is-sharing" : ""}
                  onClick={screenSharing ? stopScreenShare : startScreenShare}
                >
                  <span aria-hidden="true">▣</span>
                  {screenSharing ? "Stop sharing" : "Share screen"}
                </button>
              ) : null}
              <button type="button" className="eclass-leave-control" onClick={() => leaveClass()}>
                <span aria-hidden="true">×</span>
                Leave
              </button>
              {canModerate ? (
                <button type="button" className="eclass-end-control" onClick={() => setShowEndConfirm(true)}>
                  End class
                </button>
              ) : null}
            </div>
          </div>

          <aside className="eclass-side-panel">
            <div className="eclass-panel-tabs">
              <button type="button" className={panelTab === "chat" ? "active" : ""} onClick={() => setPanelTab("chat")}>
                Class chat
              </button>
              <button type="button" className={panelTab === "people" ? "active" : ""} onClick={() => setPanelTab("people")}>
                People <span>{sortedParticipants.length}</span>
              </button>
            </div>

            {panelTab === "chat" ? (
              <div className="eclass-chat-panel">
                <div className="eclass-chat-feed" ref={chatFeedRef}>
                  {messages.length === 0 ? (
                    <div className="eclass-chat-empty">
                      <strong>Class chat is ready</strong>
                      <span>Messages are visible to everyone in this live lesson.</span>
                    </div>
                  ) : messages.map((message) => {
                    const mine = Number(message.user_id) === myId;
                    return (
                      <div className={`eclass-chat-message ${mine ? "mine" : ""}`} key={`eclass-message-${message.id}`}>
                        {!mine ? <img src={toMediaUrl(message.avatar_url)} alt="" /> : null}
                        <div>
                          <span>{mine ? "You" : message.display_name || message.username}</span>
                          <p>{message.content}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="eclass-chat-composer">
                  <textarea
                    ref={chatInputRef}
                    rows={1}
                    maxLength={1200}
                    value={chatText}
                    onChange={(event) => setChatText(event.target.value)}
                    placeholder="Message the class"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendChat();
                      }
                    }}
                  />
                  <button type="button" onClick={sendChat} disabled={!chatText.trim()} aria-label="Send class message">Send</button>
                </div>
              </div>
            ) : (
              <div className="eclass-people-panel">
                {sortedParticipants.map((participant) => {
                  const participantRole = String(participant.community_role || "").toLowerCase();
                  const isLearner = participantRole === "member";
                  const muted = Number(participant.is_self_muted || 0) === 1 || Number(participant.is_muted_by_host || 0) === 1;
                  return (
                    <div className="eclass-person-row" key={`person-${participant.user_id}`}>
                      <div className="eclass-person-identity">
                        <div className="eclass-person-avatar">
                          <img src={toMediaUrl(participant.avatar_url)} alt="" />
                          <span className={muted ? "is-muted" : "is-open"} title={muted ? "Microphone muted" : "Microphone on"}>
                            {muted ? "×" : "•"}
                          </span>
                        </div>
                        <div>
                          <strong>{Number(participant.user_id) === myId ? "You" : participant.display_name || participant.username}</strong>
                          <span>{participantRole === "owner" ? "Owner" : participantRole === "moderator" ? "Moderator" : "Learner"}</span>
                        </div>
                      </div>
                      <div className="eclass-person-actions">
                        {Number(participant.hand_raised || 0) === 1 ? <span className="eclass-hand-badge">Hand raised</span> : null}
                        {canModerate && isLearner && Number(participant.user_id) !== myId ? (
                          <button type="button" onClick={() => moderateMute(participant)}>
                            {Number(participant.is_muted_by_host || 0) === 1 ? "Release mic" : "Mute"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>

          {Object.entries(remoteAudioStreams).map(([userId, stream]) => (
            <audio
              key={`eclass-audio-${userId}`}
              autoPlay
              playsInline
              ref={(element) => {
                if (element && element.srcObject !== stream) element.srcObject = stream;
              }}
            />
          ))}
        </div>
      )}

      {history.length > 0 && !joined ? (
        <div className="eclass-history">
          <div className="eclass-history-head">
            <h4>Recent eClasses</h4>
            <span>{history.length} saved sessions</span>
          </div>
          <div className="eclass-history-list">
            {history.slice(0, 6).map((session) => (
              <div className="eclass-history-row" key={`history-${session.id}`}>
                <div>
                  <strong>{session.title}</strong>
                  <span>{session.host_display_name || session.host_username} · {formatClassDate(session.started_at)}</span>
                </div>
                <div>
                  <b>{session.participant_count}</b>
                  <span>joined</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showEndConfirm ? (
        <div className="eclass-confirm-backdrop" role="presentation">
          <div className="eclass-confirm" role="dialog" aria-modal="true" aria-labelledby="eclass-end-title">
            <span>End for everyone</span>
            <h4 id="eclass-end-title">End this Vine eClass?</h4>
            <p>Audio, screen sharing, and live chat will close for every participant.</p>
            <div>
              <button type="button" onClick={() => setShowEndConfirm(false)} disabled={ending}>Keep class live</button>
              <button type="button" className="danger" onClick={endClass} disabled={ending}>{ending ? "Ending..." : "End eClass"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
