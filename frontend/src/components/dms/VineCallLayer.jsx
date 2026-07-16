import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../../socket";
import { getVineUser } from "../../modules/vine/utils/vineAuth";
import "./VineCallLayer.css";

const DEFAULT_AVATAR = "/default-avatar.png";
const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
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

  const remoteAudioRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const callRef = useRef(null);
  const stateRef = useRef("idle");
  const activeStartedAtRef = useRef(null);

  const partnerName = useMemo(
    () => callPartner?.display_name || callPartner?.username || "Vine audio call",
    [callPartner]
  );

  const setStatus = (nextState, notice = "") => {
    stateRef.current = nextState;
    setCallState(nextState);
    setCallNotice(notice);
    if (nextState === "active") {
      activeStartedAtRef.current = Date.now();
      setDuration(0);
    }
  };

  const stopLocalStream = () => {
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
    stopLocalStream();
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    callRef.current = null;
    activeStartedAtRef.current = null;
    setIncomingCall(null);
    setMuted(false);
    setDuration(0);
    setCallPartner(null);
    setStatus("idle", notice);
  };

  const emitCallEvent = (eventName, extra = {}) => {
    const call = callRef.current;
    if (!call?.conversationId || !call?.callId) return;
    socket.emit(eventName, {
      conversationId: call.conversationId,
      callId: call.callId,
      fromUserId: myId,
      toUserId: call.remoteUserId,
      ...extra,
    });
  };

  const createPeerConnection = (call) => {
    if (peerRef.current) {
      try {
        peerRef.current.close();
      } catch {}
    }
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerRef.current = pc;
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      emitCallEvent("dm_call_signal", { candidate: event.candidate });
    };
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams || [];
      if (remoteAudioRef.current && remoteStream) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.play?.().catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setStatus("active", "Audio connected");
      }
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        if (stateRef.current !== "idle") resetCall("Call ended");
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

  const startCall = async ({ conversationId, toUserId, partner }) => {
    if (!conversationId || !toUserId || !myId || stateRef.current !== "idle") return;
    const callId = `${conversationId}-${myId}-${Date.now()}`;
    const call = {
      conversationId,
      callId,
      remoteUserId: Number(toUserId),
    };
    callRef.current = call;
    setCallPartner(partner || null);
    setStatus("outgoing", "Calling...");
    try {
      const pc = createPeerConnection(call);
      const stream = await getLocalAudioStream();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      emitCallEvent("dm_call_invite", { offer });
    } catch (err) {
      resetCall(err?.message || "Could not start audio call.");
    }
  };

  const answerCall = async () => {
    if (!incomingCall) return;
    setStatus("connecting", "Connecting...");
    try {
      const pc = createPeerConnection(callRef.current);
      const stream = await getLocalAudioStream();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      emitCallEvent("dm_call_accept", { answer });
      setIncomingCall(null);
      setStatus("active", "Audio connected");
    } catch (err) {
      emitCallEvent("dm_call_end");
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
    window.__vineCallLayerActive = true;
    const handleStart = (event) => startCall(event.detail || {});
    window.addEventListener("vine:start-audio-call", handleStart);
    return () => {
      window.removeEventListener("vine:start-audio-call", handleStart);
      window.__vineCallLayerActive = false;
      if (callRef.current) emitCallEvent("dm_call_end");
      resetCall();
    };
  }, [myId]);

  useEffect(() => {
    if (callState !== "active") return undefined;
    const timer = window.setInterval(() => {
      if (!activeStartedAtRef.current) return;
      setDuration(Math.floor((Date.now() - activeStartedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [callState]);

  useEffect(() => {
    if (callState !== "outgoing") return undefined;
    const timer = window.setTimeout(() => {
      if (stateRef.current !== "outgoing") return;
      emitCallEvent("dm_call_end");
      resetCall("No answer");
    }, 45000);
    return () => window.clearTimeout(timer);
  }, [callState]);

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
      callRef.current = {
        conversationId: payload.conversationId,
        callId: payload.callId,
        remoteUserId: Number(payload.fromUserId || 0),
      };
      setIncomingCall(payload);
      setCallPartner(payload.caller || null);
      setStatus("incoming", "Incoming audio call");
    };

    const handleAccept = async (payload = {}) => {
      if (payload.callId !== callRef.current?.callId || !payload.answer || !peerRef.current) return;
      try {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
        setStatus("active", "Audio connected");
      } catch {
        resetCall("Call connection failed");
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
      resetCall("Call ended");
    };

    const handleSignal = async (payload = {}) => {
      if (payload.callId !== callRef.current?.callId || !payload.candidate || !peerRef.current) return;
      try {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch {}
    };

    socket.on("dm_call_invite", handleInvite);
    socket.on("dm_call_accept", handleAccept);
    socket.on("dm_call_decline", handleDecline);
    socket.on("dm_call_end", handleEnd);
    socket.on("dm_call_signal", handleSignal);
    return () => {
      socket.off("dm_call_invite", handleInvite);
      socket.off("dm_call_accept", handleAccept);
      socket.off("dm_call_decline", handleDecline);
      socket.off("dm_call_end", handleEnd);
      socket.off("dm_call_signal", handleSignal);
    };
  }, [myId]);

  if (callState === "idle" && !callNotice) return null;

  return (
    <div className={`vine-call-layer ${callState === "idle" ? "notice" : ""}`}>
      <audio ref={remoteAudioRef} autoPlay playsInline />
      <div className="vine-call-panel">
        <button
          type="button"
          className="vine-call-dm-link"
          onClick={() => {
            const cid = callRef.current?.conversationId || incomingCall?.conversationId;
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
          <span>{callState === "incoming" ? "Vine audio call" : callNotice || "Vine audio"}</span>
          <strong>{partnerName}</strong>
          <b>{callState === "active" ? formatDuration(duration) : callState === "idle" ? callNotice : callNotice}</b>
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
            <button type="button" className="vine-call-action answer" onClick={() => setCallNotice("")}>
              OK
            </button>
          </div>
        ) : (
          <div className="vine-call-actions">
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
