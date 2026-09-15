import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./CommunityQuests.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const QUEST_EMOJIS = ["🏆", "🌱", "📚", "💪", "✨", "🤝"];
const DEFAULT_AVATAR = "/default-avatar.png";

const defaultDeadline = () => {
  const value = new Date();
  value.setDate(value.getDate() + 7);
  return value.toISOString().slice(0, 10);
};

const formatDeadline = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No deadline";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
};

const getCommunityLevelName = (level) => {
  if (level >= 10) return "Legend";
  if (level >= 7) return "Champion";
  if (level >= 4) return "Builder";
  if (level >= 2) return "Contributor";
  return "Sprout";
};

export default function CommunityQuests({ communityId, viewerRole = "member" }) {
  const token = localStorage.getItem("vine_token");
  const [quests, setQuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("🏆");
  const [targetCount, setTargetCount] = useState(20);
  const [endsAt, setEndsAt] = useState(defaultDeadline);
  const [notice, setNotice] = useState("");
  const [celebrating, setCelebrating] = useState(false);
  const [leaders, setLeaders] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const celebrationTimerRef = useRef(null);
  const canManage = useMemo(() => ["owner", "moderator"].includes(String(viewerRole || "").toLowerCase()), [viewerRole]);

  const loadQuests = useCallback(async (signal) => {
    if (!communityId || !token) return;
    setLoading(true);
    try {
      const response = await fetch(`${API}/api/vine/communities/${communityId}/quests`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not load quests");
      setQuests(Array.isArray(data.quests) ? data.quests : []);
    } catch (error) {
      if (error?.name !== "AbortError") setNotice(error.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [communityId, token]);

  const loadLeaderboard = useCallback(async (signal) => {
    if (!communityId || !token) return;
    setLeaderboardLoading(true);
    try {
      const response = await fetch(`${API}/api/vine/communities/${communityId}/quests/leaderboard`, {
        headers: { Authorization: `Bearer ${token}` }, signal, cache: "no-store",
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error("Could not load quest standings");
      setLeaders(Array.isArray(data) ? data : []);
    } catch (error) {
      if (error?.name !== "AbortError") setLeaders([]);
    } finally {
      if (!signal?.aborted) setLeaderboardLoading(false);
    }
  }, [communityId, token]);

  useEffect(() => {
    const controller = new AbortController();
    loadQuests(controller.signal);
    loadLeaderboard(controller.signal);
    return () => {
      controller.abort();
      if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
    };
  }, [loadLeaderboard, loadQuests]);

  const createQuest = async (event) => {
    event.preventDefault();
    if (!title.trim() || busyId) return;
    setBusyId("create");
    setNotice("");
    try {
      const deadline = new Date(`${endsAt}T23:59:00`);
      const response = await fetch(`${API}/api/vine/communities/${communityId}/quests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), emoji, target_count: Number(targetCount), ends_at: deadline.toISOString() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not create quest");
      setTitle("");
      setEmoji("🏆");
      setTargetCount(20);
      setEndsAt(defaultDeadline());
      setComposerOpen(false);
      await loadQuests();
      await loadLeaderboard();
      setNotice("Quest launched. The whole community can contribute now.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const contribute = async (questId) => {
    if (busyId) return;
    setBusyId(questId);
    setNotice("");
    try {
      const response = await fetch(`${API}/api/vine/communities/${communityId}/quests/${questId}/check-in`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not add your contribution");
      setQuests((current) => current.map((quest) => Number(quest.id) === Number(questId)
        ? { ...quest, progress: data.progress, target: data.target, percent: data.percent, complete: data.complete, status: data.complete ? "completed" : quest.status, viewer_checked_today: true }
        : quest));
      if (data.complete) {
        setCelebrating(true);
        if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
        celebrationTimerRef.current = window.setTimeout(() => setCelebrating(false), 2600);
      }
      await loadLeaderboard();
      setNotice(data.complete ? "Quest complete — the community did it! 🏆" : "Your contribution is in. Come back tomorrow to help again.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const removeQuest = async (questId) => {
    if (busyId || !window.confirm("Remove this community quest?")) return;
    setBusyId(questId);
    try {
      const response = await fetch(`${API}/api/vine/communities/${communityId}/quests/${questId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not remove quest");
      setQuests((current) => current.filter((quest) => Number(quest.id) !== Number(questId)));
      await loadLeaderboard();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="community-quests" aria-labelledby="community-quests-title">
      <div className="community-quests-hero">
        <div>
          <span>Win it together</span>
          <h4 id="community-quests-title">Community Quests 🏆</h4>
          <p>Every daily contribution moves the whole community closer to the finish line.</p>
        </div>
        {canManage && <button type="button" onClick={() => setComposerOpen((open) => !open)}>{composerOpen ? "Close" : "+ New quest"}</button>}
      </div>

      {composerOpen && canManage && (
        <form className="community-quest-composer" onSubmit={createQuest}>
          <label className="community-quest-title-field"><span>What are you taking on together?</span><input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 120))} placeholder="Example: Finish 30 study sessions" maxLength={120} required /></label>
          <div className="community-quest-form-row">
            <fieldset><legend>Quest icon</legend><div className="community-quest-emojis">{QUEST_EMOJIS.map((option) => <button key={option} type="button" className={emoji === option ? "active" : ""} onClick={() => setEmoji(option)} aria-label={`Use ${option}`}>{option}</button>)}</div></fieldset>
            <label><span>Community target</span><input type="number" min="2" max="500" value={targetCount} onChange={(event) => setTargetCount(event.target.value)} /></label>
            <label><span>Deadline</span><input type="date" min={new Date().toISOString().slice(0, 10)} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label>
          </div>
          <button className="community-quest-launch" type="submit" disabled={!title.trim() || busyId === "create"}>{busyId === "create" ? "Launching…" : "Launch quest"}</button>
        </form>
      )}

      {notice && <div className={`community-quest-notice ${celebrating ? "celebrating" : ""}`} role="status">{celebrating && <span className="quest-confetti" aria-hidden="true">✦ ✧ ✦</span>}{notice}</div>}

      {(leaderboardLoading || leaders.length > 0 || (!loading && quests.length > 0)) && <aside className="community-quest-leaderboard" aria-label="Quest leaderboard">
        <div className="community-quest-leaderboard-head"><div><span>Community momentum</span><strong>Quest leaderboard</strong></div><small>Updates after every check-in</small></div>
        {leaderboardLoading ? <div className="community-quest-leaderboard-state">Calculating community standings…</div> : leaders.length === 0 ? <div className="community-quest-leaderboard-state">The first contribution will start the leaderboard.</div> : <div className="community-quest-leaders">{leaders.slice(0, 3).map((leader, index) => {
          const avatar = leader.avatar_url ? (String(leader.avatar_url).startsWith("http") ? leader.avatar_url : `${API}${leader.avatar_url}`) : DEFAULT_AVATAR;
          return <div key={leader.id} className={`quest-leader rank-${index + 1}`}><b aria-label={`Rank ${index + 1}`}>{index + 1}</b><img src={avatar} alt="" onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }} /><span>{leader.display_name || leader.username}</span><small>Level {leader.community_level || 1} {getCommunityLevelName(Number(leader.community_level || 1))} · {leader.quests_won || 0} won · {leader.contributions || 0} check-ins</small><div className="quest-level-track" aria-label={`${leader.level_progress || 0} of ${leader.level_target || 5} check-ins to next level`}><i style={{ width: `${Math.min(100, (Number(leader.level_progress || 0) / Number(leader.level_target || 5)) * 100)}%` }} /></div></div>;
        })}</div>}
      </aside>}

      {loading ? (
        <div className="community-quest-empty">Gathering the quests…</div>
      ) : quests.length === 0 ? (
        <div className="community-quest-empty"><span aria-hidden="true">🌱</span><strong>No quests yet</strong><p>{canManage ? "Launch a small challenge your community can finish together." : "An admin can start the first shared challenge."}</p></div>
      ) : (
        <div className="community-quest-grid">
          {quests.map((quest) => {
            const ended = quest.expired || quest.status === "completed" || quest.complete;
            return (
              <article key={quest.id} className={`community-quest-card ${quest.complete || quest.status === "completed" ? "complete" : ""}`}>
                <div className="community-quest-card-head">
                  <span className="community-quest-icon" aria-hidden="true">{quest.emoji || "🏆"}</span>
                  <div><strong>{quest.title}</strong><small>by {quest.creator_display_name || quest.creator_username} · ends {formatDeadline(quest.ends_at)}</small></div>
                  {canManage && <button type="button" className="community-quest-remove" onClick={() => removeQuest(quest.id)} disabled={Boolean(busyId)} aria-label={`Remove ${quest.title}`}>•••</button>}
                </div>
                <div className="community-quest-progress-copy"><span>{quest.complete || quest.status === "completed" ? "Completed" : `${quest.progress || 0} of ${quest.target || quest.target_count}`}</span><strong>{quest.percent || 0}%</strong></div>
                <div className="community-quest-progress" aria-label={`${quest.percent || 0}% complete`}><span style={{ width: `${quest.percent || 0}%` }} /></div>
                <div className="community-quest-card-foot">
                  <small>{quest.viewer_checked_today ? "You helped today ✓" : ended ? "This quest has ended" : "One contribution per day"}</small>
                  <button type="button" onClick={() => contribute(quest.id)} disabled={ended || quest.viewer_checked_today || Boolean(busyId)}>{quest.viewer_checked_today ? "Contributed" : quest.complete ? "Won 🏆" : busyId === quest.id ? "Adding…" : "Contribute today"}</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
