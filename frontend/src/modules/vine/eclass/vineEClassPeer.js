export const hasTurnRelay = (config) => (config?.iceServers || []).some((server) =>
  [server.urls].flat().some((url) => /^turns?:/i.test(String(url)))
  && Boolean(server.username && server.credential));

// Perfect negotiation assigns one polite peer so simultaneous offers cannot deadlock.
export function createEClassPeer({
  myId, remoteUserId, configuration, localStream, screenStream,
  sendSignal, onTrack, onState, onError,
  PeerConnection = globalThis.RTCPeerConnection,
  timers = globalThis,
}) {
  const pc = new PeerConnection(configuration);
  const polite = Number(myId) > Number(remoteUserId);
  let closed = false;
  let makingOffer = false;
  let ignoreOffer = false;
  let settingRemoteAnswer = false;
  let signals = Promise.resolve();
  let pendingCandidates = [];
  let recoveryTimer = null;
  let connectionTimer = null;
  let restartAttempts = 0;

  const clearTimers = () => {
    timers.clearTimeout(recoveryTimer);
    timers.clearTimeout(connectionTimer);
    recoveryTimer = null;
    connectionTimer = null;
  };
  const armConnectionTimeout = () => {
    timers.clearTimeout(connectionTimer);
    connectionTimer = timers.setTimeout(() => {
      if (!closed && pc.connectionState !== "connected") onState("failed");
    }, 25000);
  };
  const restart = () => {
    if (closed) return;
    onState("connecting");
    armConnectionTimeout();
    pc.restartIce();
  };

  pc.onnegotiationneeded = async () => {
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      if (!closed) sendSignal({ description: pc.localDescription });
    } catch (error) {
      if (!closed) onError(error);
    } finally {
      makingOffer = false;
    }
  };
  pc.onicecandidate = ({ candidate }) => {
    if (candidate && !closed) sendSignal({ candidate });
  };
  pc.ontrack = (event) => { if (!closed) onTrack(event); };
  const updateState = () => {
    if (closed) return;
    if (pc.connectionState === "connected") {
      clearTimers();
      restartAttempts = 0;
      onState("connected");
      return;
    }
    const failed = pc.connectionState === "failed" || pc.iceConnectionState === "failed";
    const disconnected = pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected";
    if (failed || disconnected) {
      onState(failed ? "failed" : "connecting");
      if (restartAttempts < 2 && recoveryTimer === null) {
        recoveryTimer = timers.setTimeout(() => {
          recoveryTimer = null;
          restartAttempts += 1;
          restart();
        }, failed ? 500 : 4000);
      }
    }
  };
  pc.onconnectionstatechange = updateState;
  pc.oniceconnectionstatechange = updateState;

  const applySignal = async ({ description, candidate }) => {
    if (closed) return;
    if (description) {
      const readyForOffer = !makingOffer
        && (pc.signalingState === "stable" || settingRemoteAnswer);
      const collision = description.type === "offer" && !readyForOffer;
      ignoreOffer = !polite && collision;
      if (ignoreOffer) return;
      settingRemoteAnswer = description.type === "answer";
      try {
        // setRemoteDescription performs rollback on the polite side when required.
        await pc.setRemoteDescription(description);
      } finally {
        settingRemoteAnswer = false;
      }
      if (closed) return;
      for (const queued of pendingCandidates) {
        await pc.addIceCandidate(queued).catch(() => {});
      }
      pendingCandidates = [];
      if (description.type === "offer") {
        await pc.setLocalDescription();
        if (!closed) sendSignal({ description: pc.localDescription });
      }
    }
    if (candidate && !ignoreOffer) {
      if (pc.remoteDescription) await pc.addIceCandidate(candidate);
      else if (pendingCandidates.length < 128) pendingCandidates.push(candidate);
    }
  };

  onState("connecting");
  armConnectionTimeout();
  localStream?.getAudioTracks().forEach((track) => pc.addTrack(track, localStream));
  screenStream?.getVideoTracks().forEach((track) => pc.addTrack(track, screenStream));

  return {
    pc,
    receive(payload) {
      // Socket callbacks are concurrent; preserve SDP/ICE ordering for each peer.
      signals = signals.then(() => applySignal(payload)).catch((error) => {
        if (!closed && !ignoreOffer) onError(error);
      });
      return signals;
    },
    restart,
    close() {
      closed = true;
      clearTimers();
      pendingCandidates = [];
      pc.onnegotiationneeded = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
    },
  };
}
