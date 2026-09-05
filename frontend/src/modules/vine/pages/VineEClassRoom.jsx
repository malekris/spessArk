import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import VineEClass from "../components/VineEClass";
import { getVineToken } from "../utils/vineAuth";
import "./VineEClassRoom.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const LAUNCH_RETRY_MS = 750;
const LAUNCH_RETRY_LIMIT = 20;

export default function VineEClassRoom() {
  const { communityId: rawCommunityId } = useParams();
  const [searchParams] = useSearchParams();
  const communityId = Number(rawCommunityId || 0);
  const token = getVineToken();
  const shouldWaitForLaunch = searchParams.get("launching") === "1";
  const isHandoff = searchParams.get("handoff") === "1";
  const [community, setCommunity] = useState(null);
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const communityPath = useMemo(() => {
    const slug = String(community?.slug || "").trim();
    return slug ? `/vine/communities/${encodeURIComponent(slug)}?tab=eclass` : "/vine/communities";
  }, [community?.slug]);

  const loadLiveClass = useCallback(async () => {
    if (!communityId || !token) throw new Error("Class details are unavailable.");
    const response = await fetch(`${API}/api/vine/communities/${communityId}/eclass/live`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Vine eClass could not be opened.");
    if (data.community) setCommunity(data.community);
    if (!data.session?.id) return false;
    setSession(data.session);
    setMessages(Array.isArray(data.messages) ? data.messages : []);
    setStatus("ready");
    return true;
  }, [communityId, token]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;
    let attempts = 0;

    const run = async () => {
      try {
        const found = await loadLiveClass();
        if (cancelled || found) return;
        attempts += 1;
        if (shouldWaitForLaunch && attempts < LAUNCH_RETRY_LIMIT) {
          retryTimer = window.setTimeout(run, LAUNCH_RETRY_MS);
          return;
        }
        setStatus("empty");
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || "Vine eClass could not be opened.");
        setStatus("error");
      }
    };

    const initialDelay = isHandoff ? 700 : 0;
    retryTimer = window.setTimeout(run, initialDelay);
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [isHandoff, loadLiveClass, shouldWaitForLaunch]);

  const closeWindow = () => {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) window.location.assign(communityPath);
    }, 120);
  };

  return (
    <main className="vine-eclass-window">
      <header className="vine-eclass-window-bar">
        <a href={communityPath} aria-label="Back to community">←</a>
        <div>
          <strong>Vine eClass</strong>
          <span>{community?.name || "Live classroom"}</span>
        </div>
        <button type="button" onClick={closeWindow} aria-label="Close eClass window" title="Close window">×</button>
      </header>

      {status === "loading" ? (
        <section className="vine-eclass-window-state" role="status">
          <span className="vine-eclass-window-loader" aria-hidden="true" />
          <strong>{shouldWaitForLaunch ? "Preparing your classroom" : "Opening Vine eClass"}</strong>
          <p>Connecting the live room and audio controls...</p>
        </section>
      ) : status === "error" ? (
        <section className="vine-eclass-window-state is-error" role="alert">
          <strong>eClass could not open</strong>
          <p>{error}</p>
          <a href={communityPath}>Return to community</a>
        </section>
      ) : status === "empty" || !session?.id || !community?.id ? (
        <section className="vine-eclass-window-state">
          <strong>This class is no longer live</strong>
          <p>The moderator may have ended it, or the room did not finish starting.</p>
          <a href={communityPath}>Return to community</a>
        </section>
      ) : (
        <VineEClass
          community={community}
          token={token}
          initialSession={session}
          initialMessages={messages}
          onSessionChange={setSession}
          autoJoin
          fullWindow
        />
      )}
    </main>
  );
}
