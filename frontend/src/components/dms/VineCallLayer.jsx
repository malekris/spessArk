import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../../socket";
import { getVineUser } from "../../modules/vine/utils/vineAuth";
import "./VineCallLayer.css";

const DEFAULT_AVATAR = "/default-avatar.png";
const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const CONNECTION_TIMEOUT_MS = 25000;
const DISCONNECT_GRACE_MS = 12000;
const TURN_URLS = String(import.meta.env.VITE_TURN_URLS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const TURN_USERNAME = String(import.meta.env.VITE_TURN_USERNAME || "").trim();
const TURN_CREDENTIAL = String(import.meta.env.VITE_TURN_CREDENTIAL || "").trim();
const TURN_SERVER = TURN_URLS.length
  ? {
      urls: TURN_URLS,
      ...(TURN_USERNAME && TURN_CREDENTIAL
        ? { username: TURN_USERNAME, credential: TURN_CREDENTIAL }
        : {}),
    }
  : null;
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    ...(TURN_SERVER ? [TURN_SERVER] : []),
  ],
  iceCandidatePoolSize: 10,
};

const formatDuration = (seconds) => {
  const safe = Math.max(0, Number(seconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
};

const getAvatarUrl = (user) => {
  const raw = String(user?.avatar_url || "").trim();
  if (!raw) return DEFAULT_AVATAR;
  return raw.startsWith("http") ? raw : `${API}${raw}`;
};

export default function VineCallLayer() {
  const navigate = useNavigate();
  const currentUser = getVineUser();
  const myId = Number(currentUser?.id || 0);
  const [callState, setCallState] = useState("idle");
  const [callNotice, setCallNotice] = useState("");
  const [callPartner, setCallPartner] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const remoteAudioRef = useRef(null);
  const ringtoneAudioRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const callRef = useRef(null);
  const stateRef = useRef("idle");
  const activeStartedAtRef = useRef(null);
  const noticeConversationIdRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const disconnectTimerRef = useRef(null);
  const connectedEventSentRef = useRef(false);

  const partnerName = useMemo(
    () => callPartner?.display_name || callPartner?.username || "Vine audio call",
    [callPartner]
  );

  const setStatus = useCallback((nextState, notice = "") => {
    stateRef.current = nextState;
    setCallState(nextState);
    setCallNotice(notice);
    if (nextState === "active" && !activeStartedAtRef.current) {
      activeStartedAtRef.current = Date.now();
      setDuration(0);
    }
  }, []);

  const clearDisconnectTimer = useCallback(() => {
    if (disconnectTimerRef.current) {
      window.clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  }, []);

  const resumeRemoteAudio = useCallback(async () => {
    const audio = remoteAudioRef.current;
    if (!audio?.srcObject) return false;
    audio.muted = false;
    audio.volume = 1;
    try {
      await audio.play();
      setAudioBlocked(false);
      return true;
    } catch {
      setAudioBlocked(true);
      return false;
    }
  }, []);

  const flushPendingIceCandidates = useCallback(async (pc) => {
    if (!pc?.remoteDescription || pc.signalingState === "closed") return;
    const pending = pendingIceCandidatesRef.current.splice(0);
    for (const candidate of pending) {
      if (pc.signalingState === "closed") return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // A stale candidate from a superseded network path can be ignored.
      }
    }
  }, []);

  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
  }, []);

  const resetCall = useCallback((notice = "") => {
    const endingCall = callRef.current;
    if (endingCall?.conversationId) {
      noticeConversationIdRef.current = endingCall.conversationId;
    }
    if (peerRef.current) {
      try {
        peerRef.current.close();
      } catch {
        // The peer may already be closed during teardown.
      }
      peerRef.current = null;
    }
    clearDisconnectTimer();
    stopLocalStream();
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (ringtoneAudioRef.current) {
      ringtoneAudioRef.current.pause();
      ringtoneAudioRef.current.currentTime = 0;
    }
    navigator.vibrate?.(0);
    callRef.current = null;
    activeStartedAtRef.current = null;
    pendingIceCandidatesRef.current = [];
    connectedEventSentRef.current = false;
    setIncomingCall(null);
    setMuted(false);
    setDuration(0);
    setAudioBlocked(false);
    if (!notice) setCallPartner(null);
    setStatus("idle", notice);
  }, [clearDisconnectTimer, setStatus, stopLocalStream]);

  const emitCallEvent = useCallback((eventName, extra = {}) => {
    const call = callRef.current;
    if (!call?.conversationId || !call?.callId) return;
    socket.emit(eventName, {
      conversationId: call.conversationId,
      callId: call.callId,
      fromUserId: myId,
      toUserId: call.remoteUserId,
      ...extra,
    });
  }, [myId]);

  const createPeerConnection = useCallback(() => {
    if (peerRef.current) {
      try {
        peerRef.current.close();
      } catch {
        // Replacing an already-closed peer is harmless.
      }
    }
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerRef.current = pc;
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      emitCallEvent("dm_call_signal", { candidate: event.candidate });
    };
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams || [];
      const playableStream = remoteStream || (event.track ? new MediaStream([event.track]) : null);
      if (remoteAudioRef.current && playableStream) {
        remoteAudioRef.current.srcObject = playableStream;
        event.track.onunmute = () => {
          void resumeRemoteAudio();
        };
        void resumeRemoteAudio();
      }
    };

    const handleConnectionState = () => {
      if (peerRef.current !== pc || stateRef.current === "idle") return;
      const isConnected =
        pc.connectionState === "connected" ||
        ["connected", "completed"].includes(pc.iceConnectionState);
      if (isConnected) {
        clearDisconnectTimer();
        setStatus("active", "Audio connected");
        if (!connectedEventSentRef.current) {
          connectedEventSentRef.current = true;
          emitCallEvent("dm_call_connected");
        }
        void resumeRemoteAudio();
        return;
      }

      const hasFailed = pc.connectionState === "failed" || pc.iceConnectionState === "failed";
      if (hasFailed) {
        emitCallEvent("dm_call_end", { reason: "connection_failed" });
        resetCall("Audio connection failed");
        return;
      }

      const isDisconnected =
        pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected";
      if (!isDisconnected || disconnectTimerRef.current) return;
      setStatus("reconnecting", "Reconnecting audio...");
      disconnectTimerRef.current = window.setTimeout(() => {
        disconnectTimerRef.current = null;
        if (peerRef.current !== pc || stateRef.current === "idle") return;
        const recovered =
          pc.connectionState === "connected" ||
          ["connected", "completed"].includes(pc.iceConnectionState);
        if (recovered) return;
        emitCallEvent("dm_call_end", { reason: "connection_lost" });
        resetCall("Audio connection lost");
      }, DISCONNECT_GRACE_MS);
    };
    pc.onconnectionstatechange = handleConnectionState;
    pc.oniceconnectionstatechange = handleConnectionState;
    return pc;
  }, [clearDisconnectTimer, emitCallEvent, resetCall, resumeRemoteAudio, setStatus]);

  const getLocalAudioStream = useCallback(async () => {
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
    stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
      if ("contentHint" in track) track.contentHint = "speech";
    });
    localStreamRef.current = stream;
    return stream;
  }, []);

  const startCall = useCallback(async ({ conversationId, toUserId, partner }) => {
    if (!conversationId || !toUserId || !myId || stateRef.current !== "idle") return;
    const callId = `${conversationId}-${myId}-${Date.now()}`;
    const call = {
      conversationId,
      callId,
      remoteUserId: Number(toUserId),
    };
    callRef.current = call;
    pendingIceCandidatesRef.current = [];
    connectedEventSentRef.current = false;
    setAudioBlocked(false);
    noticeConversationIdRef.current = conversationId;
    setCallPartner(partner || null);
    setStatus("outgoing", "Calling...");
    try {
      const pc = createPeerConnection();
      const stream = await getLocalAudioStream();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      emitCallEvent("dm_call_invite", { offer });
    } catch (err) {
      resetCall(err?.message || "Could not start audio call.");
    }
  }, [createPeerConnection, emitCallEvent, getLocalAudioStream, myId, resetCall, setStatus]);

  const answerCall = async () => {
    if (!incomingCall) return;
    setStatus("connecting", "Connecting...");
    try {
      const pc = createPeerConnection();
      const stream = await getLocalAudioStream();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      await flushPendingIceCandidates(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      emitCallEvent("dm_call_accept", { answer });
      setIncomingCall(null);
    } catch (err) {
      emitCallEvent("dm_call_end", { reason: "negotiation_failed" });
      resetCall(err?.message || "Could not answer audio call.");
    }
  };

  const declineCall = () => {
    emitCallEvent("dm_call_decline");
    resetCall("Call declined");
  };

  const endCall = () => {
    emitCallEvent("dm_call_end");
    resetCall("Call ended");
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
  };

  useEffect(() => {
    if (typeof Audio === "undefined") return undefined;
    const audio = new Audio("/vine-incoming-call.mp3");
    audio.preload = "auto";
    audio.loop = true;
    audio.setAttribute("playsinline", "");
    ringtoneAudioRef.current = audio;

    const unlockRingtone = () => {
      audio.muted = true;
      audio.play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
          if (stateRef.current === "incoming") {
            audio.play().catch(() => {});
          }
          document.removeEventListener("pointerdown", unlockRingtone, true);
          document.removeEventListener("keydown", unlockRingtone, true);
        })
        .catch(() => {
          audio.muted = false;
        });
    };

    document.addEventListener("pointerdown", unlockRingtone, true);
    document.addEventListener("keydown", unlockRingtone, true);
    return () => {
      document.removeEventListener("pointerdown", unlockRingtone, true);
      document.removeEventListener("keydown", unlockRingtone, true);
      audio.pause();
      audio.src = "";
      if (ringtoneAudioRef.current === audio) ringtoneAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    window.__vineCallLayerActive = true;
    const handleStart = (event) => startCall(event.detail || {});
    window.addEventListener("vine:start-audio-call", handleStart);
    return () => {
      window.removeEventListener("vine:start-audio-call", handleStart);
      window.__vineCallLayerActive = false;
      if (callRef.current) emitCallEvent("dm_call_end");
      resetCall();
    };
  }, [emitCallEvent, resetCall, startCall]);

  useEffect(() => {
    if (!["active", "reconnecting"].includes(callState)) return undefined;
    const timer = window.setInterval(() => {
      if (!activeStartedAtRef.current) return;
      setDuration(Math.floor((Date.now() - activeStartedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [callState]);

  useEffect(() => {
    if (callState !== "connecting") return undefined;
    const timer = window.setTimeout(() => {
      if (stateRef.current !== "connecting") return;
      emitCallEvent("dm_call_end", { reason: "connection_timeout" });
      resetCall("Audio could not connect");
    }, CONNECTION_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [callState, emitCallEvent, resetCall]);

  useEffect(() => {
    if (callState !== "outgoing") return undefined;
    const timer = window.setTimeout(() => {
      if (stateRef.current !== "outgoing") return;
      emitCallEvent("dm_call_end");
      resetCall("No answer");
    }, 45000);
    return () => window.clearTimeout(timer);
  }, [callState, emitCallEvent, resetCall]);

  useEffect(() => {
    const handleInvite = (payload = {}) => {
      if (Number(payload.fromUserId) === Number(myId)) return;
      if (payload.toUserId && Number(payload.toUserId) !== Number(myId)) return;
      if (!payload.conversationId || !payload.callId || !payload.offer) return;
      if (stateRef.current !== "idle") {
        socket.emit("dm_call_decline", {
          conversationId: payload.conversationId,
          callId: payload.callId,
          fromUserId: myId,
          toUserId: payload.fromUserId,
          reason: "busy",
        });
        return;
      }
      pendingIceCandidatesRef.current = [];
      connectedEventSentRef.current = false;
      setAudioBlocked(false);
      callRef.current = {
        conversationId: payload.conversationId,
        callId: payload.callId,
        remoteUserId: Number(payload.fromUserId || 0),
      };
      noticeConversationIdRef.current = payload.conversationId;
      setIncomingCall(payload);
      setCallPartner(payload.caller || null);
      setStatus("incoming", "Incoming audio call");
    };

    const handleAccept = async (payload = {}) => {
      if (payload.callId !== callRef.current?.callId || !payload.answer || !peerRef.current) return;
      setStatus("connecting", "Connecting audio...");
      try {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
        await flushPendingIceCandidates(peerRef.current);
      } catch {
        emitCallEvent("dm_call_end", { reason: "negotiation_failed" });
        resetCall("Audio connection failed");
      }
    };

    const handleDecline = (payload = {}) => {
      if (payload.callId !== callRef.current?.callId) return;
      resetCall(
        payload.reason === "busy"
          ? "User is already on a call"
          : payload.reason === "offline"
            ? "User is offline. Missed call notification sent"
            : "Call declined"
      );
    };

    const handleEnd = (payload = {}) => {
      if (payload.callId !== callRef.current?.callId) return;
      resetCall(payload.reason === "disconnected" ? "Audio connection lost" : "Call ended");
    };

    const handleAnsweredElsewhere = (payload = {}) => {
      if (payload.callId !== callRef.current?.callId || stateRef.current !== "incoming") return;
      resetCall("Answered on another device");
    };

    const handleSignal = async (payload = {}) => {
      if (payload.callId !== callRef.current?.callId || !payload.candidate) return;
      const pc = peerRef.current;
      if (!pc?.remoteDescription) {
        pendingIceCandidatesRef.current = [
          ...pendingIceCandidatesRef.current.slice(-127),
          payload.candidate,
        ];
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch {
        // Ignore stale candidates that arrive after a network path changes.
      }
    };

    socket.on("dm_call_invite", handleInvite);
    socket.on("dm_call_accept", handleAccept);
    socket.on("dm_call_decline", handleDecline);
    socket.on("dm_call_end", handleEnd);
    socket.on("dm_call_answered_elsewhere", handleAnsweredElsewhere);
    socket.on("dm_call_signal", handleSignal);
    return () => {
      socket.off("dm_call_invite", handleInvite);
      socket.off("dm_call_accept", handleAccept);
      socket.off("dm_call_decline", handleDecline);
      socket.off("dm_call_end", handleEnd);
      socket.off("dm_call_answered_elsewhere", handleAnsweredElsewhere);
      socket.off("dm_call_signal", handleSignal);
    };
  }, [emitCallEvent, flushPendingIceCandidates, myId, resetCall, setStatus]);

  useEffect(() => {
    const audio = ringtoneAudioRef.current;
    if (!audio) return undefined;

    if (callState !== "incoming") {
      audio.pause();
      audio.currentTime = 0;
      navigator.vibrate?.(0);
      return undefined;
    }

    audio.loop = true;
    audio.muted = false;
    audio.volume = 0.72;
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Mobile browsers can block audio until the first interaction; vibration remains available.
    });
    navigator.vibrate?.([650, 300, 650, 1100]);

    return () => {
      audio.pause();
      audio.currentTime = 0;
      navigator.vibrate?.(0);
    };
  }, [callState]);

  if (callState === "idle" && !callNotice) return null;

  return (
    <div className={`vine-call-layer ${callState === "idle" ? "notice" : ""}`}>
      <audio ref={remoteAudioRef} autoPlay playsInline />
      <div className="vine-call-panel">
        <button
          type="button"
          className="vine-call-dm-link"
          onClick={() => {
            const cid =
              callRef.current?.conversationId ||
              incomingCall?.conversationId ||
              noticeConversationIdRef.current;
            if (cid) navigate(`/vine/dms/${cid}`);
          }}
        >
          Open DM
        </button>
        <div className="vine-call-orb">
          <img
            src={getAvatarUrl(callPartner)}
            alt=""
            onError={(e) => {
              e.currentTarget.src = DEFAULT_AVATAR;
            }}
          />
        </div>
        <div className="vine-call-copy">
          <span>
            {callState === "incoming"
              ? "Vine audio call"
              : callState === "idle"
                ? "Call update"
                : callNotice || "Vine audio"}
          </span>
          <strong>{partnerName}</strong>
          <b>{["active", "reconnecting"].includes(callState) ? formatDuration(duration) : callNotice}</b>
        </div>

        {callState === "incoming" ? (
          <div className="vine-call-actions">
            <button type="button" className="vine-call-action answer" onClick={answerCall}>
              Answer
            </button>
            <button type="button" className="vine-call-action end" onClick={declineCall}>
              Decline
            </button>
          </div>
        ) : callState === "idle" ? (
          <div className="vine-call-actions">
            <button
              type="button"
              className="vine-call-action answer"
              onClick={() => {
                setCallNotice("");
                setCallPartner(null);
                noticeConversationIdRef.current = null;
              }}
            >
              OK
            </button>
          </div>
        ) : (
          <div className={`vine-call-actions ${audioBlocked ? "has-audio-recovery" : ""}`}>
            {audioBlocked ? (
              <button type="button" className="vine-call-action sound" onClick={resumeRemoteAudio}>
                Enable audio
              </button>
            ) : null}
            <button
              type="button"
              className={`vine-call-action mute ${muted ? "active" : ""}`}
              onClick={toggleMute}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button type="button" className="vine-call-action end" onClick={endCall}>
              End call
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
