/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { socket } from "../../../socket";
import { getVineToken, getVineUser } from "../utils/vineAuth";

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

const VineEClassContext = createContext(null);

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
    const handleConnect = () => {
      window.clearTimeout(timer);
      socket.emit("register", userId);
      resolve();
    };
    const timer = window.setTimeout(() => {
      socket.off("connect", handleConnect);
      reject(new Error("Vine realtime connection is unavailable"));
    }, 10000);
    socket.once("connect", handleConnect);
    socket.connect();
  });

export function VineEClassProvider({ children }) {
  const currentUser = getVineUser() || {};
  const myId = Number(currentUser.id || 0);
  const [session, setSession] = useState(null);
  const [community, setCommunity] = useState(null);
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
  const [notice, setNotice] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [activeSpeakerId, setActiveSpeakerId] = useState(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);

  const sessionRef = useRef(null);
  const communityRef = useRef(null);
  const joinedRef = useRef(false);
  const localAudioRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const audioElementsRef = useRef(new Map());
  const activeSpeakerRef = useRef(null);
  const lastSpeakerAtRef = useRef(0);

  const updateSession = useCallback((nextSession, nextCommunity = communityRef.current) => {
    sessionRef.current = nextSession || null;
    communityRef.current = nextCommunity || null;
    setSession(nextSession || null);
    setCommunity(nextCommunity || null);
  }, []);

  const mergeParticipant = useCallback((participant) => {
    if (!participant?.user_id) return;
    setParticipants((previous) => {
      const exists = previous.some((entry) => Number(entry.user_id) === Number(participant.user_id));
      return exists
        ? previous.map((entry) => Number(entry.user_id) === Number(participant.user_id)
          ? { ...entry, ...participant }
          : entry)
        : [...previous, participant];
    });
  }, []);

  const stopMediaAndPeers = useCallback(() => {
    for (const pc of peerConnectionsRef.current.values()) {
      try {
        pc.close();
      } catch {
        // The peer may already be closed during route or network teardown.
      }
    }
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localAudioRef.current?.getTracks().forEach((track) => track.stop());
    localAudioRef.current = null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    for (const audio of audioElementsRef.current.values()) {
      audio.srcObject = null;
    }
    audioElementsRef.current.clear();
    setLocalScreen(null);
    setRemoteScreen(null);
    setRemoteAudioStreams({});
    setScreenSharing(false);
    setAudioBlocked(false);
    setCaptionsEnabled(false);
    activeSpeakerRef.current = null;
    lastSpeakerAtRef.current = 0;
    setActiveSpeakerId(null);
  }, []);

  const leaveClass = useCallback(async ({ notifyServer = true, message = "" } = {}) => {
    const sessionId = Number(sessionRef.current?.id || 0);
    if (notifyServer && sessionId && joinedRef.current) {
      socket.emit("eclass_leave", { sessionId });
    }
    stopMediaAndPeers();
    joinedRef.current = false;
    setJoined(false);
    setParticipants([]);
    setMessages([]);
    setSelfMuted(true);
    setHostMuted(false);
    setHandRaised(false);
    setNotice(message);
    updateSession(null, null);
  }, [stopMediaAndPeers, updateSession]);

  const sendSignal = useCallback((targetUserId, payload) => {
    const sessionId = Number(sessionRef.current?.id || 0);
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
        // A superseded network path can leave a stale ICE candidate behind.
      }
    }
  }, []);

  const enableAudio = useCallback(async () => {
    const audioElements = Array.from(audioElementsRef.current.values());
    if (audioElements.length === 0) {
      setAudioBlocked(false);
      return false;
    }
    let played = 0;
    for (const audio of audioElements) {
      audio.muted = false;
      audio.volume = 1;
      try {
        await audio.play();
        played += 1;
      } catch {
        // A visible tap-to-hear control will retry blocked mobile playback.
      }
    }
    const blocked = played !== audioElements.length;
    setAudioBlocked(blocked);
    return played > 0;
  }, []);

  const createPeerConnection = useCallback((remoteUserId) => {
    const uid = Number(remoteUserId);
    const existing = peerConnectionsRef.current.get(uid);
    if (existing && existing.signalingState !== "closed") return existing;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnectionsRef.current.set(uid, pc);
    let reconnectTimer = null;
    let iceRestartAttempts = 0;

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
      event.track.onunmute = () => {
        window.requestAnimationFrame(() => { void enableAudio(); });
      };
      window.requestAnimationFrame(() => { void enableAudio(); });
    };
    const clearReconnectTimer = () => {
      if (!reconnectTimer) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };
    const restartPeerIce = async () => {
      reconnectTimer = null;
      if (!joinedRef.current || pc.signalingState === "closed" || iceRestartAttempts >= 2) return;
      if (pc.signalingState !== "stable") {
        reconnectTimer = window.setTimeout(restartPeerIce, 1_000);
        return;
      }
      iceRestartAttempts += 1;
      try {
        pc.restartIce?.();
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        sendSignal(uid, { description: pc.localDescription });
      } catch (err) {
        console.warn("Vine eClass audio recovery failed:", err?.message || err);
      }
    };
    const removeFailedPeer = () => {
      clearReconnectTimer();
      if (peerConnectionsRef.current.get(uid) === pc) peerConnectionsRef.current.delete(uid);
      setRemoteAudioStreams((previous) => {
        const next = { ...previous };
        delete next[uid];
        return next;
      });
    };
    const handleConnectionState = () => {
      const connected = pc.connectionState === "connected" || ["connected", "completed"].includes(pc.iceConnectionState);
      if (connected) {
        clearReconnectTimer();
        iceRestartAttempts = 0;
        window.requestAnimationFrame(() => { void enableAudio(); });
        return;
      }
      if (pc.connectionState === "closed") {
        removeFailedPeer();
        return;
      }
      const failed = pc.connectionState === "failed" || pc.iceConnectionState === "failed";
      const disconnected = pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected";
      if ((failed || disconnected) && iceRestartAttempts < 2 && !reconnectTimer) {
        reconnectTimer = window.setTimeout(restartPeerIce, failed ? 0 : 4_000);
        return;
      }
      if (failed && iceRestartAttempts >= 2) {
        removeFailedPeer();
        setNotice("An audio connection failed. Leave and rejoin if it does not recover.");
      }
    };
    pc.onconnectionstatechange = handleConnectionState;
    pc.oniceconnectionstatechange = handleConnectionState;
    return pc;
  }, [enableAudio, sendSignal]);

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
    if (Number(payload.sessionId) !== Number(sessionRef.current?.id) || Number(payload.targetUserId) !== myId) return;
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

  useEffect(() => {
    const handleEnded = (payload = {}) => {
      if (Number(payload.sessionId) !== Number(sessionRef.current?.id)) return;
      const message = payload.reason === "host_absent"
        ? "This Vine eClass ended because the host did not return within 10 minutes."
        : "This Vine eClass has ended.";
      void leaveClass({ notifyServer: false, message });
    };
    const handleParticipantJoined = ({ sessionId, participant } = {}) => {
      if (Number(sessionId) !== Number(sessionRef.current?.id)) return;
      mergeParticipant(participant);
    };
    const handleParticipantLeft = ({ sessionId, userId } = {}) => {
      if (Number(sessionId) !== Number(sessionRef.current?.id)) return;
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
      if (Number(message?.session_id) !== Number(sessionRef.current?.id)) return;
      setMessages((previous) => previous.some((entry) => Number(entry.id) === Number(message.id))
        ? previous
        : [...previous, message]);
    };
    const handleAudioState = ({ sessionId, userId, muted } = {}) => {
      if (Number(sessionId) !== Number(sessionRef.current?.id)) return;
      setParticipants((previous) => previous.map((entry) => Number(entry.user_id) === Number(userId)
        ? { ...entry, is_self_muted: muted ? 1 : 0 }
        : entry));
    };
    const handleModeratedMute = ({ sessionId, userId, muted } = {}) => {
      if (Number(sessionId) !== Number(sessionRef.current?.id)) return;
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
        setNotice("Your microphone is available again.");
      }
    };
    const handleRaisedHand = ({ sessionId, userId, raised } = {}) => {
      if (Number(sessionId) !== Number(sessionRef.current?.id)) return;
      setParticipants((previous) => previous.map((entry) => Number(entry.user_id) === Number(userId)
        ? { ...entry, hand_raised: raised ? 1 : 0 }
        : entry));
    };
    const handleScreenState = ({ sessionId, userId, sharing } = {}) => {
      if (Number(sessionId) !== Number(sessionRef.current?.id)) return;
      if (!sharing) setRemoteScreen((current) => Number(current?.userId) === Number(userId) ? null : current);
    };

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
  }, [handleSignal, leaveClass, mergeParticipant, myId]);

  useEffect(() => {
    if (!joined) return undefined;
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return undefined;

    const audioContext = new AudioContextConstructor();
    const analysers = [];
    const attachStream = (userId, stream) => {
      if (!stream?.getAudioTracks?.().some((track) => track.readyState === "live")) return;
      try {
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.68;
        source.connect(analyser);
        analysers.push({
          userId: Number(userId),
          source,
          analyser,
          samples: new Uint8Array(analyser.fftSize),
        });
      } catch {
        // One unsupported stream should not disable speaker detection for the room.
      }
    };

    attachStream(myId, localAudioRef.current);
    Object.entries(remoteAudioStreams).forEach(([userId, stream]) => attachStream(userId, stream));
    void audioContext.resume().catch(() => {});

    const sampleTimer = window.setInterval(() => {
      if (document.visibilityState === "hidden" || audioContext.state === "closed") return;
      let strongestUserId = null;
      let strongestLevel = 0.028;
      for (const entry of analysers) {
        entry.analyser.getByteTimeDomainData(entry.samples);
        let energy = 0;
        for (const sample of entry.samples) {
          const normalized = (sample - 128) / 128;
          energy += normalized * normalized;
        }
        const level = Math.sqrt(energy / entry.samples.length);
        if (level > strongestLevel) {
          strongestLevel = level;
          strongestUserId = entry.userId;
        }
      }

      if (strongestUserId) {
        lastSpeakerAtRef.current = Date.now();
        if (activeSpeakerRef.current !== strongestUserId) {
          activeSpeakerRef.current = strongestUserId;
          setActiveSpeakerId(strongestUserId);
        }
        return;
      }

      if (activeSpeakerRef.current && Date.now() - lastSpeakerAtRef.current > 1100) {
        activeSpeakerRef.current = null;
        setActiveSpeakerId(null);
      }
    }, 240);

    return () => {
      window.clearInterval(sampleTimer);
      analysers.forEach(({ source }) => source.disconnect());
      void audioContext.close().catch(() => {});
    };
  }, [joined, myId, remoteAudioStreams]);

  useEffect(() => () => {
    if (joinedRef.current && sessionRef.current?.id) {
      socket.emit("eclass_leave", { sessionId: sessionRef.current.id });
    }
    stopMediaAndPeers();
  }, [stopMediaAndPeers]);

  const joinClass = useCallback(async ({ session: nextSession, community: nextCommunity, initialMessages = [] }) => {
    if (!nextSession?.id || !nextCommunity?.id || joining) {
      return { ok: false, message: "Class details are unavailable" };
    }
    if (joinedRef.current && Number(sessionRef.current?.id) === Number(nextSession.id)) {
      return { ok: true, alreadyJoined: true };
    }
    if (joinedRef.current) {
      return { ok: false, message: "Leave your current Vine eClass before joining another." };
    }
    setJoining(true);
    setNotice("");
    try {
      await waitForSocket(myId);
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Audio classes are not supported by this browser");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      stream.getAudioTracks().forEach((track) => {
        track.enabled = false;
        if ("contentHint" in track) track.contentHint = "speech";
      });
      localAudioRef.current = stream;
      updateSession({
        ...nextSession,
        community_name: nextSession.community_name || nextCommunity.name || "",
        community_slug: nextSession.community_slug || nextCommunity.slug || "",
      }, nextCommunity);
      const response = await emitWithAck("eclass_join", {
        sessionId: Number(nextSession.id),
        communityId: Number(nextCommunity.id),
        token: getVineToken(),
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
      setMessages(Array.isArray(initialMessages) ? initialMessages : []);
      joinedRef.current = true;
      setJoined(true);
      for (const participant of existing) await makeOffer(participant.user_id);
      return { ok: true };
    } catch (err) {
      localAudioRef.current?.getTracks().forEach((track) => track.stop());
      localAudioRef.current = null;
      updateSession(null, null);
      const message = err?.message || "Could not join Vine eClass";
      setNotice(message);
      return { ok: false, message };
    } finally {
      setJoining(false);
    }
  }, [joining, makeOffer, myId, updateSession]);

  const toggleSelfMute = useCallback(async () => {
    if (!joinedRef.current || !sessionRef.current?.id) return;
    if (hostMuted && selfMuted) {
      setNotice("A moderator has muted your microphone.");
      return;
    }
    const nextMuted = !selfMuted;
    const response = await emitWithAck("eclass_audio_state", {
      sessionId: sessionRef.current.id,
      muted: nextMuted,
    });
    if (!response?.ok) {
      setNotice(response?.message || "Microphone could not be changed");
      return;
    }
    setSelfMuted(nextMuted);
    localAudioRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
  }, [hostMuted, selfMuted]);

  const toggleHand = useCallback(async () => {
    if (!joinedRef.current || !sessionRef.current?.id) return;
    const raised = !handRaised;
    const response = await emitWithAck("eclass_raise_hand", {
      sessionId: sessionRef.current.id,
      raised,
    });
    if (response?.ok) setHandRaised(raised);
  }, [handRaised]);

  const moderateMute = useCallback(async (participant) => {
    if (!sessionRef.current?.id) return;
    const nextMuted = Number(participant.is_muted_by_host || 0) !== 1;
    const response = await emitWithAck("eclass_moderate_mute", {
      sessionId: sessionRef.current.id,
      targetUserId: participant.user_id,
      muted: nextMuted,
    });
    if (!response?.ok) setNotice(response?.message || "Microphone control failed");
  }, []);

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
    if (sessionRef.current?.id) {
      socket.emit("eclass_screen_state", { sessionId: sessionRef.current.id, sharing: false });
    }
  }, [makeOffer]);

  const startScreenShare = useCallback(async () => {
    if (!joinedRef.current || screenSharing) return;
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
      socket.emit("eclass_screen_state", { sessionId: sessionRef.current.id, sharing: true });
      track.onended = () => { void stopScreenShare(); };
    } catch (err) {
      if (String(err?.name || "") !== "NotAllowedError") {
        setNotice(err?.message || "Screen sharing could not start");
      }
    }
  }, [makeOffer, screenSharing, stopScreenShare]);

  const sendChat = useCallback(async (contentValue) => {
    const content = String(contentValue || "").trim();
    if (!content || !joinedRef.current || !sessionRef.current?.id) return { ok: false };
    const response = await emitWithAck("eclass_chat", {
      sessionId: sessionRef.current.id,
      content,
    });
    if (!response?.ok) setNotice(response?.message || "Message could not be sent");
    return response;
  }, []);

  const toggleCaptions = useCallback(() => {
    setCaptionsEnabled((enabled) => !enabled);
  }, []);

  const sortedParticipants = useMemo(() => [...participants].sort((a, b) => {
    const aRole = ["owner", "moderator"].includes(String(a.community_role || "").toLowerCase()) ? 0 : 1;
    const bRole = ["owner", "moderator"].includes(String(b.community_role || "").toLowerCase()) ? 0 : 1;
    if (aRole !== bRole) return aRole - bRole;
    if (Number(a.hand_raised || 0) !== Number(b.hand_raised || 0)) {
      return Number(b.hand_raised || 0) - Number(a.hand_raised || 0);
    }
    return String(a.display_name || a.username || "").localeCompare(String(b.display_name || b.username || ""));
  }), [participants]);

  const value = useMemo(() => ({
    session,
    community,
    messages,
    participants: sortedParticipants,
    joined,
    joining,
    selfMuted,
    hostMuted,
    handRaised,
    screenSharing,
    remoteScreen,
    localScreen,
    notice,
    audioBlocked,
    activeSpeakerId,
    captionsEnabled,
    myId,
    joinClass,
    leaveClass,
    toggleSelfMute,
    toggleHand,
    moderateMute,
    startScreenShare,
    stopScreenShare,
    sendChat,
    enableAudio,
    toggleCaptions,
    setNotice,
  }), [
    session,
    community,
    messages,
    sortedParticipants,
    joined,
    joining,
    selfMuted,
    hostMuted,
    handRaised,
    screenSharing,
    remoteScreen,
    localScreen,
    notice,
    audioBlocked,
    activeSpeakerId,
    captionsEnabled,
    myId,
    joinClass,
    leaveClass,
    toggleSelfMute,
    toggleHand,
    moderateMute,
    startScreenShare,
    stopScreenShare,
    sendChat,
    enableAudio,
    toggleCaptions,
  ]);

  return (
    <VineEClassContext.Provider value={value}>
      {children}
      <div hidden aria-hidden="true">
        {Object.entries(remoteAudioStreams).map(([userId, stream]) => (
          <audio
            key={`persistent-eclass-audio-${userId}`}
            autoPlay
            playsInline
            ref={(element) => {
              const uid = Number(userId);
              if (!element) {
                audioElementsRef.current.delete(uid);
                return;
              }
              audioElementsRef.current.set(uid, element);
              element.muted = false;
              element.volume = 1;
              if (element.srcObject !== stream) element.srcObject = stream;
              element.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
            }}
          />
        ))}
      </div>
    </VineEClassContext.Provider>
  );
}

export function useVineEClass() {
  const context = useContext(VineEClassContext);
  if (!context) throw new Error("useVineEClass must be used inside VineEClassProvider");
  return context;
}
