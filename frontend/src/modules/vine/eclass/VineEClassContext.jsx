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
import { createEClassPeer, hasTurnRelay } from "./vineEClassPeer";
import VineEClassAudio from "./VineEClassAudio";

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
  const [screenShareSurface, setScreenShareSurface] = useState(null);
  const [remoteScreen, setRemoteScreen] = useState(null);
  const [localScreen, setLocalScreen] = useState(null);
  const [remoteAudioStreams, setRemoteAudioStreams] = useState({});
  const [notice, setNotice] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [peerAudioStates, setPeerAudioStates] = useState({});
  const [relayConfigured, setRelayConfigured] = useState(hasTurnRelay(RTC_CONFIG));
  const [reconnecting, setReconnecting] = useState(false);
  const [activeSpeakerId, setActiveSpeakerId] = useState(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);

  const sessionRef = useRef(null);
  const communityRef = useRef(null);
  const joinedRef = useRef(false);
  const localAudioRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const audioElementsRef = useRef(new Map());
  const blockedAudioRef = useRef(new Set());
  const rtcConfigRef = useRef(RTC_CONFIG);
  const earlySignalsRef = useRef([]);
  const earlyParticipantsRef = useRef(new Map());
  const joinAttemptRef = useRef(0);
  const joiningRef = useRef(false);
  const restoringRef = useRef(false);
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
    for (const peer of peerConnectionsRef.current.values()) {
      try {
        peer.close();
      } catch {
        // The peer may already be closed during route or network teardown.
      }
    }
    peerConnectionsRef.current.clear();
    earlySignalsRef.current = [];
    earlyParticipantsRef.current.clear();
    localAudioRef.current?.getTracks().forEach((track) => track.stop());
    localAudioRef.current = null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    for (const audio of audioElementsRef.current.values()) {
      audio.srcObject = null;
    }
    audioElementsRef.current.clear();
    blockedAudioRef.current.clear();
    setLocalScreen(null);
    setScreenShareSurface(null);
    setRemoteScreen(null);
    setRemoteAudioStreams({});
    setScreenSharing(false);
    setAudioBlocked(false);
    setPeerAudioStates({});
    setCaptionsEnabled(false);
    activeSpeakerRef.current = null;
    lastSpeakerAtRef.current = 0;
    setActiveSpeakerId(null);
  }, []);

  const leaveClass = useCallback(async ({ notifyServer = true, message = "" } = {}) => {
    joinAttemptRef.current += 1;
    joiningRef.current = false;
    restoringRef.current = false;
    setJoining(false);
    setReconnecting(false);
    const sessionId = Number(sessionRef.current?.id || 0);
    if (notifyServer && sessionId && socket.connected) {
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
    if (!sessionId || !targetUserId || !socket.connected) return;
    socket.emit("eclass_signal", {
      sessionId,
      targetUserId: Number(targetUserId),
      ...payload,
    });
  }, []);

  const onPlayback = useCallback((userId, blocked) => {
    const uid = Number(userId);
    if (blocked) blockedAudioRef.current.add(uid);
    else blockedAudioRef.current.delete(uid);
    setAudioBlocked(blockedAudioRef.current.size > 0);
  }, []);

  const registerAudio = useCallback((userId, element) => {
    const uid = Number(userId);
    if (element) audioElementsRef.current.set(uid, element);
    else {
      audioElementsRef.current.delete(uid);
      onPlayback(uid, false);
    }
  }, [onPlayback]);

  const enableAudio = useCallback(async () => {
    // Start every play() synchronously within the tap's user-activation window.
    const results = await Promise.all(Array.from(audioElementsRef.current, async ([uid, audio]) => {
      audio.muted = false;
      audio.volume = 1;
      try {
        await audio.play();
        if (audioElementsRef.current.get(uid) === audio) onPlayback(uid, false);
        return true;
      } catch {
        if (audioElementsRef.current.get(uid) === audio) onPlayback(uid, true);
        return false;
      }
    }));
    return results.length > 0 && results.every(Boolean);
  }, [onPlayback]);

  const createPeerConnection = useCallback((remoteUserId) => {
    const uid = Number(remoteUserId);
    const existing = peerConnectionsRef.current.get(uid);
    if (existing && existing.pc.signalingState !== "closed") return existing;
    const peer = createEClassPeer({
      myId, remoteUserId: uid, configuration: rtcConfigRef.current,
      localStream: localAudioRef.current, screenStream: screenStreamRef.current,
      sendSignal: (payload) => sendSignal(uid, payload),
      onState: (state) => setPeerAudioStates((previous) => previous[uid] === state
        ? previous : { ...previous, [uid]: state }),
      onError: (error) => {
        console.warn("Vine eClass audio negotiation:", error?.message || error);
        setPeerAudioStates((previous) => ({ ...previous, [uid]: "failed" }));
      },
      onTrack: ({ track }) => {
        const stream = new MediaStream([track]);
        if (track.kind === "video") {
          setRemoteScreen({ userId: uid, stream });
          track.onended = () => {
            setRemoteScreen((current) => current?.stream === stream ? null : current);
          };
        } else {
          setRemoteAudioStreams((previous) => ({ ...previous, [uid]: stream }));
        }
      },
    });
    peerConnectionsRef.current.set(uid, peer);
    return peer;
  }, [myId, sendSignal]);

  const handleSignal = useCallback(async (payload = {}) => {
    if (Number(payload.sessionId) !== Number(sessionRef.current?.id) || Number(payload.targetUserId) !== myId) return;
    const remoteUserId = Number(payload.fromUserId);
    if (!remoteUserId || remoteUserId === myId) return;
    if (!joinedRef.current) {
      if (earlySignalsRef.current.length < 512) earlySignalsRef.current.push(payload);
      return;
    }
    await createPeerConnection(remoteUserId).receive(payload);
  }, [createPeerConnection, myId]);

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
      if (Number(participant?.user_id) === myId || !participant?.user_id) return;
      if (joinedRef.current) createPeerConnection(participant.user_id);
      else earlyParticipantsRef.current.set(Number(participant.user_id), participant);
    };
    const handleParticipantLeft = ({ sessionId, userId } = {}) => {
      if (Number(sessionId) !== Number(sessionRef.current?.id)) return;
      const uid = Number(userId);
      setParticipants((previous) => previous.filter((entry) => Number(entry.user_id) !== uid));
      const pc = peerConnectionsRef.current.get(uid);
      if (pc) pc.close();
      peerConnectionsRef.current.delete(uid);
      earlyParticipantsRef.current.delete(uid);
      setPeerAudioStates((previous) => {
        const next = { ...previous };
        delete next[uid];
        return next;
      });
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
  }, [createPeerConnection, handleSignal, leaveClass, mergeParticipant, myId]);

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
    joinAttemptRef.current += 1;
    if (joinedRef.current && sessionRef.current?.id) {
      socket.emit("eclass_leave", { sessionId: sessionRef.current.id });
    }
    stopMediaAndPeers();
  }, [stopMediaAndPeers]);

  const finishJoining = useCallback((response) => {
    rtcConfigRef.current = hasTurnRelay(response.rtcConfig) ? response.rtcConfig : RTC_CONFIG;
    setRelayConfigured(hasTurnRelay(rtcConfigRef.current));
    const self = response.self || {};
    const mutedOnEntry = Number(self.is_self_muted || 0) === 1 || Number(self.is_muted_by_host || 0) === 1;
    localAudioRef.current?.getAudioTracks().forEach((track) => { track.enabled = !mutedOnEntry; });
    setSelfMuted(mutedOnEntry);
    setHostMuted(Number(self.is_muted_by_host || 0) === 1);
    setHandRaised(Number(self.hand_raised || 0) === 1);
    const roster = new Map();
    [self, ...(response.participants || []), ...earlyParticipantsRef.current.values()].forEach((entry) => {
      if (entry?.user_id) roster.set(Number(entry.user_id), entry);
    });
    earlyParticipantsRef.current.clear();
    setParticipants(Array.from(roster.values()));
    joinedRef.current = true;
    setJoined(true);
    setReconnecting(false);
    for (const uid of roster.keys()) {
      if (uid !== myId) createPeerConnection(uid);
    }
    const queued = earlySignalsRef.current;
    earlySignalsRef.current = [];
    queued.forEach((payload) => { void handleSignal(payload); });
  }, [createPeerConnection, handleSignal, myId]);

  useEffect(() => {
    let restoreMuted = true;
    const onDisconnect = () => {
      if (!joinedRef.current && !restoringRef.current) return;
      if (joinedRef.current) restoreMuted = !localAudioRef.current?.getAudioTracks().some((track) => track.enabled);
      joinAttemptRef.current += 1;
      joiningRef.current = false;
      restoringRef.current = false;
      joinedRef.current = false;
      setReconnecting(true);
      for (const peer of peerConnectionsRef.current.values()) peer.close();
      peerConnectionsRef.current.clear();
      setPeerAudioStates({});
      setRemoteAudioStreams({});
      setRemoteScreen(null);
    };
    const onConnect = async () => {
      const liveSession = sessionRef.current;
      if (!liveSession?.id || joinedRef.current || joiningRef.current || !localAudioRef.current) return;
      const attempt = ++joinAttemptRef.current;
      joiningRef.current = true;
      restoringRef.current = true;
      try {
        const response = await emitWithAck("eclass_join", {
          sessionId: liveSession.id, token: getVineToken(),
        });
        if (attempt !== joinAttemptRef.current) return;
        if (!response.ok) throw new Error(response.message || "Could not reconnect to the class.");
        if (restoreMuted) {
          await emitWithAck("eclass_audio_state", { sessionId: liveSession.id, muted: true });
          response.self = { ...response.self, is_self_muted: 1 };
        }
        if (attempt !== joinAttemptRef.current) return;
        finishJoining(response);
        if (screenStreamRef.current) socket.emit("eclass_screen_state", { sessionId: liveSession.id, sharing: true });
      } catch (error) {
        if (attempt === joinAttemptRef.current) {
          void leaveClass({ message: error.message || "Please rejoin the class." });
        }
      } finally {
        if (attempt === joinAttemptRef.current) {
          joiningRef.current = false;
          restoringRef.current = false;
        }
      }
    };
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);
    return () => {
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
    };
  }, [finishJoining, leaveClass]);

  const joinClass = useCallback(async ({ session: nextSession, community: nextCommunity, initialMessages = [] }) => {
    if (!nextSession?.id || !nextCommunity?.id || joiningRef.current) {
      return { ok: false, message: "Class details are unavailable" };
    }
    if (joinedRef.current && Number(sessionRef.current?.id) === Number(nextSession.id)) {
      return { ok: true, alreadyJoined: true };
    }
    if (joinedRef.current) {
      return { ok: false, message: "Leave your current Vine eClass before joining another." };
    }
    const attempt = ++joinAttemptRef.current;
    joiningRef.current = true;
    setJoining(true);
    setNotice("");
    setParticipants([]);
    try {
      await waitForSocket(myId);
      if (attempt !== joinAttemptRef.current) return { ok: false };
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Audio classes are not supported by this browser");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (attempt !== joinAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return { ok: false };
      }
      stream.getAudioTracks().forEach((track) => {
        track.enabled = false;
        if ("contentHint" in track) track.contentHint = "speech";
      });
      localAudioRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          setSelfMuted(true);
          setNotice("Your microphone stopped. Leave and rejoin to reconnect it.");
          if (sessionRef.current?.id) socket.emit("eclass_audio_state", { sessionId: sessionRef.current.id, muted: true });
        };
      });
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
      if (attempt !== joinAttemptRef.current) return { ok: false };
      if (!response?.ok) throw new Error(response?.message || "Could not join Vine eClass");
      setMessages(Array.isArray(initialMessages) ? initialMessages : []);
      finishJoining(response);
      return { ok: true };
    } catch (err) {
      if (attempt !== joinAttemptRef.current) return { ok: false };
      if (sessionRef.current?.id) socket.emit("eclass_leave", { sessionId: sessionRef.current.id });
      stopMediaAndPeers();
      joinedRef.current = false;
      setJoined(false);
      setParticipants([]);
      updateSession(null, null);
      const message = err?.message || "Could not join Vine eClass";
      setNotice(message);
      return { ok: false, message };
    } finally {
      if (attempt === joinAttemptRef.current) {
        setJoining(false);
        joiningRef.current = false;
      }
    }
  }, [finishJoining, myId, stopMediaAndPeers, updateSession]);

  const toggleSelfMute = useCallback(async () => {
    if (!joinedRef.current || !sessionRef.current?.id) return;
    if (hostMuted && selfMuted) {
      setNotice("A moderator has muted your microphone.");
      return;
    }
    const nextMuted = !selfMuted;
    if (!nextMuted && !localAudioRef.current?.getAudioTracks().some((track) => track.readyState === "live")) {
      setNotice("Your microphone is disconnected. Leave and rejoin to choose it again.");
      return;
    }
    void enableAudio();
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
  }, [enableAudio, hostMuted, selfMuted]);

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
    setScreenShareSurface(null);
    setScreenSharing(false);
    for (const { pc } of peerConnectionsRef.current.values()) {
      for (const sender of pc.getSenders()) {
        if (sender.track && tracks.includes(sender.track)) pc.removeTrack(sender);
      }
    }
    tracks.forEach((track) => track.stop());
    if (sessionRef.current?.id) {
      socket.emit("eclass_screen_state", { sessionId: sessionRef.current.id, sharing: false });
    }
  }, []);

  const startScreenShare = useCallback(async (surface = "window") => {
    if (!joinedRef.current || screenSharing) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice("Screen sharing is not supported on this browser.");
      return;
    }
    try {
      const requestedSurface = ["window", "browser", "monitor"].includes(surface) ? surface : "window";
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // Ask the browser to foreground the app-window picker. The user still
          // makes the final choice in the browser's privacy-controlled dialog.
          displaySurface: requestedSurface,
          cursor: "motion",
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
        preferCurrentTab: requestedSurface === "browser",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        monitorTypeSurfaces: "include",
      });
      const [track] = stream.getVideoTracks();
      if (!track) throw new Error("No screen was selected");
      const actualSurface = track.getSettings?.().displaySurface || requestedSurface;
      screenStreamRef.current = stream;
      setLocalScreen(stream);
      setScreenShareSurface(actualSurface);
      setScreenSharing(true);
      for (const { pc } of peerConnectionsRef.current.values()) {
        pc.addTrack(track, stream);
      }
      socket.emit("eclass_screen_state", { sessionId: sessionRef.current.id, sharing: true });
      track.onended = () => { void stopScreenShare(); };
    } catch (err) {
      if (String(err?.name || "") !== "NotAllowedError") {
        setNotice(err?.name === "NotFoundError"
          ? "No shareable window was found. Open the app you want to present and try again."
          : err?.message || "Screen sharing could not start");
      }
    }
  }, [screenSharing, stopScreenShare]);

  const retryAudio = useCallback(() => {
    void enableAudio();
    if (!joinedRef.current || !socket.connected) return;
    for (const peer of peerConnectionsRef.current.values()) {
      if (peer.pc.connectionState !== "connected") peer.restart();
    }
  }, [enableAudio]);

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
    screenShareSurface,
    remoteScreen,
    localScreen,
    notice,
    audioBlocked,
    peerAudioStates,
    relayConfigured,
    reconnecting,
    retryAudio,
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
    screenShareSurface,
    remoteScreen,
    localScreen,
    notice,
    audioBlocked,
    peerAudioStates,
    relayConfigured,
    reconnecting,
    retryAudio,
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
          <VineEClassAudio
            key={`persistent-eclass-audio-${userId}`}
            userId={userId}
            stream={stream}
            register={registerAudio}
            onPlayback={onPlayback}
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
