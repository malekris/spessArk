import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../../../socket";
import { useVineEClass } from "./VineEClassContext";
import { openVineEClassWindow } from "./vineEClassWindow";
import { getVineAvatarThumbnailUrl, useDefaultVineAvatarOnError } from "../utils/vineAvatar";
import "./VineEClassFeedRail.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineEClassFeedRail({ token }) {
  const navigate = useNavigate();
  const room = useVineEClass();
  const [liveClasses, setLiveClasses] = useState([]);

  const loadLiveClasses = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API}/api/vine/eclass/live-for-me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await response.json().catch(() => []);
      if (response.ok) setLiveClasses(Array.isArray(data) ? data : []);
    } catch {
      // The feed remains usable when live-class discovery is temporarily unavailable.
    }
  }, [token]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadLiveClasses(), 0);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadLiveClasses();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(initialLoad);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadLiveClasses]);

  useEffect(() => {
    const handleStarted = (payload = {}) => {
      const next = {
        ...(payload.session || payload),
        community_id: Number(payload.community_id || payload.session?.community_id || 0),
        community_name: payload.community_name || payload.session?.community_name || "",
        community_slug: payload.community_slug || payload.session?.community_slug || "",
      };
      if (!next.id || !next.community_id) return;
      setLiveClasses((previous) => [next, ...previous.filter((entry) => Number(entry.id) !== Number(next.id))]);
    };
    const handleEnded = ({ sessionId } = {}) => {
      setLiveClasses((previous) => previous.filter((entry) => Number(entry.id) !== Number(sessionId)));
    };
    socket.on("eclass_started", handleStarted);
    socket.on("eclass_ended", handleEnded);
    return () => {
      socket.off("eclass_started", handleStarted);
      socket.off("eclass_ended", handleEnded);
    };
  }, []);

  const rows = useMemo(() => {
    const active = room.joined && room.session
      ? [{
          ...room.session,
          community_name: room.session.community_name || room.community?.name || "",
          community_slug: room.session.community_slug || room.community?.slug || "",
          live_participant_count: room.participants.length,
        }]
      : [];
    const seen = new Set(active.map((entry) => Number(entry.id)));
    return [...active, ...liveClasses.filter((entry) => !seen.has(Number(entry.id)))];
  }, [liveClasses, room.community, room.joined, room.participants.length, room.session]);

  if (rows.length === 0) return null;

  const openClass = (entry, isActive) => {
    const opened = openVineEClassWindow(entry.community_id, { handoff: isActive });
    if (opened) {
      if (isActive) void room.leaveClass();
      return;
    }
    const slug = String(entry.community_slug || "").trim();
    if (slug) navigate(`/vine/communities/${slug}?tab=eclass`);
  };

  return (
    <section className="vine-eclass-feed-rail" aria-label="Live Vine eClasses">
      <div className="vine-eclass-feed-head">
        <span><i /> Vine eClass live</span>
        <small>{rows.length === 1 ? "1 class" : `${rows.length} classes`}</small>
      </div>
      <div className="vine-eclass-feed-track">
        {rows.map((entry) => {
          const isActive = room.joined && Number(room.session?.id) === Number(entry.id);
          const participantCount = isActive
            ? room.participants.length
            : Number(entry.live_participant_count || 0);
          return (
            <article className={`vine-eclass-feed-card ${isActive ? "is-listening" : ""}`} key={`feed-eclass-${entry.id}`}>
              <button type="button" className="vine-eclass-feed-main" onClick={() => openClass(entry, isActive)}>
                <span className="vine-eclass-feed-avatar">
                  <img src={getVineAvatarThumbnailUrl(entry.host_avatar_url)} onError={useDefaultVineAvatarOnError} alt="" />
                  <i />
                </span>
                <span className="vine-eclass-feed-copy">
                  <small>{isActive ? "Listening now" : `${entry.community_name || "Your community"} · Live now`}</small>
                  <strong>{entry.title || "Vine eClass"}</strong>
                  <span>{entry.host_display_name || entry.host_username || "Community moderator"}{participantCount > 0 ? ` · ${participantCount} connected` : ""}</span>
                </span>
                <span className="vine-eclass-feed-return">{isActive ? "Return" : "Join"}</span>
              </button>
              {isActive ? (
                <div className="vine-eclass-feed-actions">
                  {room.audioBlocked ? <button type="button" onClick={room.enableAudio}>Enable audio</button> : null}
                  <button type="button" onClick={room.toggleSelfMute}>{room.selfMuted ? "Unmute" : "Mute"}</button>
                  <button type="button" className="leave" onClick={() => room.leaveClass()}>Leave</button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
