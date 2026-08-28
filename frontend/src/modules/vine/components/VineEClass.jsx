import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../../../socket";
import { useVineEClass } from "../eclass/VineEClassContext";
import "./VineEClass.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

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

const getClassMessageTime = (value) => {
  if (!value) return "";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

const messagesBelongTogether = (first, second) => {
  if (!first || !second || Number(first.user_id) !== Number(second.user_id)) return false;
  const firstTime = new Date(String(first.created_at || "").replace(" ", "T")).getTime();
  const secondTime = new Date(String(second.created_at || "").replace(" ", "T")).getTime();
  if (Number.isNaN(firstTime) || Number.isNaN(secondTime)) return false;
  return Math.abs(secondTime - firstTime) <= 4 * 60 * 1000;
};

const resizeClassComposer = (element) => {
  if (!element) return;
  element.style.height = "auto";
  const maxHeight = Number.parseFloat(window.getComputedStyle(element).maxHeight) || 132;
  element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
  element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
};

export default function VineEClass({ community, token, initialSession = null, onSessionChange }) {
  const room = useVineEClass();
  const communityId = Number(community?.id || 0);
  const role = String(community?.viewer_role || "").toLowerCase();
  const canModerate = ["owner", "moderator"].includes(role);
  const [liveSession, setLiveSession] = useState(initialSession);
  const [history, setHistory] = useState([]);
  const [availableMessages, setAvailableMessages] = useState([]);
  const [chatText, setChatText] = useState("");
  const [startTitle, setStartTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [panelTab, setPanelTab] = useState("chat");
  const [localNotice, setLocalNotice] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const localScreenVideoRef = useRef(null);
  const remoteScreenVideoRef = useRef(null);
  const chatFeedRef = useRef(null);
  const chatInputRef = useRef(null);
  const chatStickToBottomRef = useRef(true);

  const isThisRoom = room.joined && Number(room.session?.community_id) === communityId;
  const displaySession = isThisRoom ? room.session : liveSession;
  const participants = useMemo(
    () => isThisRoom ? room.participants : [],
    [isThisRoom, room.participants]
  );
  const messages = isThisRoom ? room.messages : availableMessages;
  const activeScreen = isThisRoom ? room.localScreen || room.remoteScreen?.stream || null : null;
  const notice = localNotice || (isThisRoom ? room.notice : "");

  const updateSession = useCallback((session) => {
    const nextSession = session || null;
    setLiveSession(nextSession);
    onSessionChange?.(nextSession);
  }, [onSessionChange]);

  useEffect(() => {
    setLiveSession(initialSession || null);
  }, [initialSession]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = room.localScreen;
  }, [room.localScreen]);

  useEffect(() => {
    if (remoteScreenVideoRef.current) remoteScreenVideoRef.current.srcObject = room.remoteScreen?.stream || null;
  }, [room.remoteScreen]);

  useEffect(() => {
    const feed = chatFeedRef.current;
    if (feed && chatStickToBottomRef.current) feed.scrollTop = feed.scrollHeight;
  }, [messages]);

  useEffect(() => {
    resizeClassComposer(chatInputRef.current);
  }, [chatText]);

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
        if (!isThisRoom) setAvailableMessages(Array.isArray(liveData.messages) ? liveData.messages : []);
      }
      if (historyResponse.ok) setHistory(Array.isArray(historyData) ? historyData : []);
    } catch {
      setLocalNotice("Vine eClass could not be refreshed.");
    }
  }, [communityId, isThisRoom, token, updateSession]);

  useEffect(() => {
    void loadClass();
  }, [loadClass]);

  useEffect(() => {
    const handleStarted = (payload = {}) => {
      if (Number(payload.community_id || payload.communityId) !== communityId) return;
      updateSession(payload.session || payload);
      setLocalNotice("A Vine eClass is live now.");
    };
    const handleEnded = (payload = {}) => {
      if (Number(payload.sessionId) !== Number(liveSession?.id) && Number(payload.sessionId) !== Number(room.session?.id)) return;
      updateSession(null);
      setLocalNotice("This Vine eClass has ended.");
      void loadClass();
    };
    socket.on("eclass_started", handleStarted);
    socket.on("eclass_ended", handleEnded);
    return () => {
      socket.off("eclass_started", handleStarted);
      socket.off("eclass_ended", handleEnded);
    };
  }, [communityId, liveSession?.id, loadClass, room.session?.id, updateSession]);

  const joinClass = async (sessionOverride = null) => {
    const nextSession = sessionOverride || displaySession;
    if (!nextSession?.id || room.joining) return;
    const result = await room.joinClass({
      session: nextSession,
      community,
      initialMessages: availableMessages,
    });
    if (!result?.ok) setLocalNotice(result?.message || "Could not join Vine eClass");
  };

  const startClass = async () => {
    if (!canModerate || starting) return;
    setStarting(true);
    setLocalNotice("");
    try {
      const response = await fetch(`${API}/api/vine/communities/${communityId}/eclass/sessions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: startTitle.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 409) throw new Error(data.message || "Could not start Vine eClass");
      const session = data.session;
      if (!session?.id) throw new Error(data.message || "Could not start Vine eClass");
      updateSession(session);
      setAvailableMessages([]);
      setStartTitle("");
      if (response.status === 409) setLocalNotice("The existing live class has been opened.");
      await joinClass(session);
    } catch (err) {
      setLocalNotice(err?.message || "Could not start Vine eClass");
    } finally {
      setStarting(false);
    }
  };

  const endClass = async () => {
    if (!displaySession?.id || !canModerate || ending) return;
    setEnding(true);
    try {
      const response = await fetch(
        `${API}/api/vine/communities/${communityId}/eclass/sessions/${displaySession.id}/end`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not end Vine eClass");
      setShowEndConfirm(false);
      if (isThisRoom) await room.leaveClass({ notifyServer: false });
      updateSession(null);
      setLocalNotice("Vine eClass ended for everyone.");
      await loadClass();
    } catch (err) {
      setLocalNotice(err?.message || "Could not end Vine eClass");
    } finally {
      setEnding(false);
    }
  };

  const sendChat = async () => {
    const content = chatText.trim();
    if (!content || !isThisRoom) return;
    chatStickToBottomRef.current = true;
    setChatText("");
    const response = await room.sendChat(content);
    if (!response?.ok) setChatText(content);
    window.requestAnimationFrame(() => chatInputRef.current?.focus());
  };

  const hostParticipant = useMemo(
    () => participants.find((participant) => Number(participant.user_id) === Number(displaySession?.host_user_id)),
    [displaySession?.host_user_id, participants]
  );

  const dismissNotice = () => {
    setLocalNotice("");
    if (isThisRoom) room.setNotice("");
  };

  return (
    <section className="eclass-shell" aria-label="Vine eClass">
      <header className="eclass-heading">
        <div><span className="eclass-eyebrow">Live learning on Vine</span><h3>Vine eClass</h3><p>{community?.name || "Community"} live classroom</p></div>
        {displaySession ? <div className="eclass-live-pill"><i /> Live now</div> : <div className="eclass-offline-pill">No class live</div>}
      </header>

      {notice ? <div className="eclass-notice" role="status"><span>{notice}</span><button type="button" onClick={dismissNotice} aria-label="Dismiss notice">×</button></div> : null}

      {!displaySession ? (
        <div className="eclass-lobby">
          <div className="eclass-lobby-copy"><span className="eclass-lobby-mark" aria-hidden="true">V</span><div><h4>The classroom is quiet</h4><p>No live lesson is running in {community?.name || "this community"} right now.</p></div></div>
          {canModerate ? <div className="eclass-start-panel"><label htmlFor="eclass-title">Class topic</label><div className="eclass-start-row"><input id="eclass-title" value={startTitle} maxLength={180} onChange={(event) => setStartTitle(event.target.value)} placeholder={`${community?.name || "Community"} live lesson`} /><button type="button" onClick={startClass} disabled={starting}>{starting ? "Starting..." : "Start eClass"}</button></div></div> : null}
        </div>
      ) : !isThisRoom ? (
        <div className="eclass-prejoin">
          <div className="eclass-prejoin-visual"><div className="eclass-host-avatar-wrap"><img src={toMediaUrl(displaySession.host_avatar_url)} alt="" /><span className="eclass-host-live-dot" /></div><span className="eclass-prejoin-kicker">Live from {community?.name}</span><h4>{displaySession.title}</h4><p>{displaySession.host_display_name || displaySession.host_username} is hosting this community lesson.</p><div className="eclass-prejoin-meta"><span>Live {formatClassDuration(displaySession.started_at, nowMs)}</span><span>Audio class</span><span>Member only</span></div></div>
          <button type="button" className="eclass-join-btn" onClick={() => joinClass()} disabled={room.joining}>{room.joining ? "Joining securely..." : "Join Vine eClass"}</button>
          <small>Your microphone starts muted. You can unmute when you are ready to speak.</small>
        </div>
      ) : (
        <div className="eclass-room">
          <div className="eclass-main-column">
            <div className={`eclass-stage ${activeScreen ? "is-sharing" : ""}`}>
              <div className="eclass-stage-topline"><div><span className="eclass-stage-live"><i /> LIVE</span><strong>{displaySession.title}</strong></div><span>{formatClassDuration(displaySession.started_at, nowMs)}</span></div>
              {activeScreen ? (
                <div className="eclass-screen-canvas">{room.localScreen ? <video ref={localScreenVideoRef} autoPlay playsInline muted /> : <video ref={remoteScreenVideoRef} autoPlay playsInline />}<span>{room.localScreen ? "You are presenting" : "Moderator screen"}</span></div>
              ) : (
                <div className="eclass-audio-stage"><div className="eclass-audio-rings" aria-hidden="true"><i /><i /><i /></div><img className="eclass-featured-avatar" src={toMediaUrl(hostParticipant?.avatar_url || displaySession.host_avatar_url)} alt="" /><span className="eclass-speaking-label">Class hosted by</span><strong>{hostParticipant?.display_name || displaySession.host_display_name || displaySession.host_username}</strong><p>{participants.length} {participants.length === 1 ? "participant" : "participants"} connected</p></div>
              )}
              <div className="eclass-participant-strip">
                {participants.slice(0, 8).map((participant) => {
                  const muted = Number(participant.is_self_muted || 0) === 1 || Number(participant.is_muted_by_host || 0) === 1;
                  return <div className="eclass-mini-person" key={`mini-${participant.user_id}`}><div><img src={toMediaUrl(participant.avatar_url)} alt="" /><span className={muted ? "is-muted" : "is-open"} title={muted ? "Microphone muted" : "Microphone on"}>{muted ? "×" : "•"}</span></div><small>{Number(participant.user_id) === room.myId ? "You" : participant.display_name || participant.username}</small></div>;
                })}
                {participants.length > 8 ? <div className="eclass-more-people">+{participants.length - 8}</div> : null}
              </div>
            </div>

            <div className="eclass-controls" aria-label="Class controls">
              {room.audioBlocked ? <button type="button" className="eclass-audio-control" onClick={room.enableAudio}><span aria-hidden="true">🔊</span>Enable audio</button> : null}
              <button type="button" className={`eclass-mic-control ${room.selfMuted ? "is-off" : "is-on"}`} onClick={room.toggleSelfMute} title={room.selfMuted ? "Unmute microphone" : "Mute microphone"}><span aria-hidden="true">{room.selfMuted ? "🎙️" : "🎤"}</span>{room.selfMuted ? "Unmute" : "Mute"}</button>
              <button type="button" className={`eclass-hand-control ${room.handRaised ? "is-raised" : ""}`} onClick={room.toggleHand}><span aria-hidden="true">✋</span>{room.handRaised ? "Lower hand" : "Raise hand"}</button>
              {canModerate ? <button type="button" className={`eclass-share-control ${room.screenSharing ? "is-sharing" : ""}`} onClick={room.screenSharing ? room.stopScreenShare : room.startScreenShare}><span aria-hidden="true">{room.screenSharing ? "⏹️" : "🖥️"}</span>{room.screenSharing ? "Stop sharing" : "Share screen"}</button> : null}
              <button type="button" className="eclass-leave-control" onClick={() => room.leaveClass()}><span aria-hidden="true">🚪</span>Leave</button>
              {canModerate ? <button type="button" className="eclass-end-control" onClick={() => setShowEndConfirm(true)}>End class</button> : null}
            </div>
          </div>

          <aside className="eclass-side-panel">
            <div className="eclass-panel-tabs"><button type="button" className={panelTab === "chat" ? "active" : ""} onClick={() => setPanelTab("chat")}>Class chat</button><button type="button" className={panelTab === "people" ? "active" : ""} onClick={() => setPanelTab("people")}>People <span>{participants.length}</span></button></div>
            {panelTab === "chat" ? (
              <div className="eclass-chat-panel">
                <div
                  className="eclass-chat-feed"
                  ref={chatFeedRef}
                  onScroll={(event) => {
                    const feed = event.currentTarget;
                    chatStickToBottomRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
                  }}
                >
                  {messages.length === 0 ? (
                    <div className="eclass-chat-empty">
                      <span className="eclass-chat-empty-mark" aria-hidden="true"><i /><i /><i /></span>
                      <strong>Class chat is ready</strong>
                      <span>Be the first to say something.</span>
                    </div>
                  ) : messages.map((message, index) => {
                    const mine = Number(message.user_id) === room.myId;
                    const joinsPrevious = messagesBelongTogether(messages[index - 1], message);
                    const joinsNext = messagesBelongTogether(message, messages[index + 1]);
                    const groupPosition = joinsPrevious
                      ? joinsNext ? "middle" : "last"
                      : joinsNext ? "first" : "single";
                    return (
                      <div
                        className={`eclass-chat-message ${mine ? "mine" : "theirs"} group-${groupPosition}`}
                        key={`eclass-message-${message.id}`}
                      >
                        {!mine ? (
                          joinsNext
                            ? <span className="eclass-chat-avatar-spacer" aria-hidden="true" />
                            : <img src={toMediaUrl(message.avatar_url)} alt="" />
                        ) : null}
                        <div className="eclass-chat-bubble-wrap">
                          {!joinsPrevious ? (
                            <div className="eclass-chat-message-meta">
                              <strong>{mine ? "You" : message.display_name || message.username}</strong>
                              <time dateTime={message.created_at || undefined}>{getClassMessageTime(message.created_at)}</time>
                            </div>
                          ) : null}
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
                    onChange={(event) => {
                      setChatText(event.target.value);
                      resizeClassComposer(event.currentTarget);
                    }}
                    onInput={(event) => resizeClassComposer(event.currentTarget)}
                    placeholder="Message the class"
                    aria-label="Message the class"
                    enterKeyHint="send"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void sendChat();
                      }
                    }}
                  />
                  <button type="button" onClick={sendChat} disabled={!chatText.trim()} aria-label="Send class message" title="Send">
                    <span aria-hidden="true">↑</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="eclass-people-panel">
                {participants.map((participant) => {
                  const participantRole = String(participant.community_role || "").toLowerCase();
                  const isLearner = participantRole === "member";
                  const muted = Number(participant.is_self_muted || 0) === 1 || Number(participant.is_muted_by_host || 0) === 1;
                  return <div className="eclass-person-row" key={`person-${participant.user_id}`}><div className="eclass-person-identity"><div className="eclass-person-avatar"><img src={toMediaUrl(participant.avatar_url)} alt="" /><span className={muted ? "is-muted" : "is-open"} title={muted ? "Microphone muted" : "Microphone on"}>{muted ? "×" : "•"}</span></div><div><strong>{Number(participant.user_id) === room.myId ? "You" : participant.display_name || participant.username}</strong><span>{participantRole === "owner" ? "Owner" : participantRole === "moderator" ? "Moderator" : "Learner"}</span></div></div><div className="eclass-person-actions">{Number(participant.hand_raised || 0) === 1 ? <span className="eclass-hand-badge">Hand raised</span> : null}{canModerate && isLearner && Number(participant.user_id) !== room.myId ? <button type="button" onClick={() => room.moderateMute(participant)}>{Number(participant.is_muted_by_host || 0) === 1 ? "Release mic" : "Mute"}</button> : null}</div></div>;
                })}
              </div>
            )}
          </aside>
        </div>
      )}

      {history.length > 0 && !isThisRoom ? <div className="eclass-history"><div className="eclass-history-head"><h4>Recent eClasses</h4><span>{history.length} saved sessions</span></div><div className="eclass-history-list">{history.slice(0, 6).map((session) => <div className="eclass-history-row" key={`history-${session.id}`}><div><strong>{session.title}</strong><span>{session.host_display_name || session.host_username} · {formatClassDate(session.started_at)}</span></div><div><b>{session.participant_count}</b><span>joined</span></div></div>)}</div></div> : null}

      {showEndConfirm ? <div className="eclass-confirm-backdrop" role="presentation"><div className="eclass-confirm" role="dialog" aria-modal="true" aria-labelledby="eclass-end-title"><span>End for everyone</span><h4 id="eclass-end-title">End this Vine eClass?</h4><p>Audio, screen sharing, and live chat will close for every participant.</p><div><button type="button" onClick={() => setShowEndConfirm(false)} disabled={ending}>Keep class live</button><button type="button" className="danger" onClick={endClass} disabled={ending}>{ending ? "Ending..." : "End eClass"}</button></div></div></div> : null}
    </section>
  );
}
