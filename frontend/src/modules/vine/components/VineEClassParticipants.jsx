import { useMemo } from "react";
import { getVineAvatarThumbnailUrl, useDefaultVineAvatarOnError } from "../utils/vineAvatar";
import "./VineEClassParticipants.css";

export default function VineEClassParticipants({
  participants,
  hostUserId,
  myId,
  activeSpeakerId,
  peerAudioStates = {},
  compact = false,
}) {
  // Mic and raised-hand updates must not shuffle tiles while people are reading.
  const orderedParticipants = useMemo(() => [...participants].sort((a, b) => {
    const aHost = Number(a.user_id) === Number(hostUserId);
    const bHost = Number(b.user_id) === Number(hostUserId);
    return Number(bHost) - Number(aHost) || Number(a.user_id) - Number(b.user_id);
  }), [participants, hostUserId]);

  return (
    <section className={`eclass-gallery ${compact ? "is-filmstrip" : ""}`} aria-label="Class participants">
      <div className="eclass-gallery-heading">
        <strong>In this class <span>{participants.length}</span></strong>
        <span>Audio room</span>
      </div>
      <div
        className={`eclass-gallery-grid ${participants.length === 1 ? "is-solo" : ""}`}
        style={{ "--gallery-columns": participants.length <= 4 ? 2 : participants.length <= 9 ? 3 : 4 }}
        role="list"
        tabIndex={0}
        aria-label={compact ? "Participant thumbnails" : "Participant gallery"}
      >
        {orderedParticipants.map((participant) => {
          const userId = Number(participant.user_id);
          const name = participant.display_name || participant.username || "Participant";
          const isMe = userId === Number(myId);
          const isHost = userId === Number(hostUserId);
          const isModerator = ["owner", "moderator"].includes(participant.community_role);
          const mutedByHost = Number(participant.is_muted_by_host) === 1;
          const muted = Number(participant.is_self_muted) === 1 || mutedByHost;
          const speaking = !muted && userId === Number(activeSpeakerId);
          const raised = Number(participant.hand_raised) === 1;
          const micStatus = mutedByHost ? "Muted by moderator" : muted ? "Mic off" : "Mic on";
          const audioState = isMe ? null : peerAudioStates[userId];
          const connectionLabel = audioState === "failed" ? "No audio" : audioState === "connecting" ? "Connecting" : null;
          return (
            <div
              key={userId}
              role="listitem"
              className={`eclass-participant-tile tone-${userId % 4} ${speaking ? "is-speaking" : ""}`}
              data-user-id={userId}
              aria-label={`${name}${isMe ? " (you)" : ""}${isHost ? ", host" : ""}, ${connectionLabel || (speaking ? "speaking" : micStatus)}${raised ? ", hand raised" : ""}`}
            >
              <div className="eclass-tile-status">
                <span className={`eclass-tile-mic ${connectionLabel ? "is-disconnected" : muted ? "is-muted" : "is-open"}`} title={connectionLabel || micStatus}>
                  <span aria-hidden="true">{muted ? "🔇" : "🎙️"}</span>
                  <span>{connectionLabel || (muted ? "Mic off" : "Mic on")}</span>
                </span>
                {raised ? <span className="eclass-tile-hand" title="Hand raised" aria-label="Hand raised">✋</span> : null}
              </div>
              <div className="eclass-tile-portrait">
                <img
                  src={getVineAvatarThumbnailUrl(participant.avatar_url)}
                  onError={useDefaultVineAvatarOnError}
                  width={160}
                  height={160}
                  loading="lazy"
                  decoding="async"
                  alt=""
                />
                {speaking ? <span className="eclass-tile-speaking" aria-hidden="true"><i /><i /><i /></span> : null}
              </div>
              <div className="eclass-tile-identity">
                <strong title={`${name}${isMe ? " (you)" : ""}`}>{name}{isMe ? " (you)" : ""}</strong>
                <span>{speaking ? "Speaking" : isHost ? "Host" : isModerator ? "Moderator" : "Learner"}</span>
              </div>
            </div>
          );
        })}
        {participants.length === 0 ? <p className="eclass-gallery-empty">Waiting for participants...</p> : null}
      </div>
    </section>
  );
}
