import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./GroupDetailsSheet.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

export default function GroupDetailsSheet({ open, conversationId, onClose, onChanged, onLeft }) {
  const token = localStorage.getItem("vine_token");
  const currentUser = JSON.parse(localStorage.getItem("vine_user"));
  const onChangedRef = useRef(onChanged);
  const avatarInputRef = useRef(null);
  const [group, setGroup] = useState(null);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [showAddPeople, setShowAddPeople] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const loadGroup = useCallback(async () => {
    const response = await fetch(`${API}/api/dms/groups/${conversationId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not load group");
    setGroup(data);
    setName(data.group_name || "");
    onChangedRef.current?.(data);
    return data;
  }, [conversationId, token]);

  useEffect(() => {
    if (!open || !conversationId) return;
    setError("");
    loadGroup().catch((requestError) => setError(requestError?.message || "Could not load group"));
  }, [open, conversationId, loadGroup]);

  useEffect(() => {
    if (!open || !showAddPeople) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
        const response = await fetch(`${API}/api/dms/group-candidates${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await response.json().catch(() => []);
        if (response.ok) setCandidates(Array.isArray(data) ? data : []);
      } catch (requestError) {
        if (requestError?.name !== "AbortError") setError("Could not load people");
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, showAddPeople, token]);

  const memberIds = useMemo(
    () => new Set((group?.members || []).map((member) => Number(member.user_id))),
    [group]
  );
  const availableCandidates = candidates.filter((person) => !memberIds.has(Number(person.id)));

  const runAction = async (key, url, options, fallbackError, refreshAfter = true) => {
    setBusyKey(key);
    setError("");
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...(options?.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${token}`,
          ...(options?.headers || {}),
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || fallbackError);
      if (data?.conversation_type === "group") {
        setGroup(data);
        setName(data.group_name || "");
        onChanged?.(data);
      } else if (refreshAfter) {
        await loadGroup();
      }
      return true;
    } catch (requestError) {
      setError(requestError?.message || fallbackError);
      return false;
    } finally {
      setBusyKey("");
    }
  };

  const renameGroup = async (event) => {
    event.preventDefault();
    const cleanName = name.replace(/\s+/g, " ").trim();
    if (cleanName.length < 2 || cleanName === group?.group_name) return;
    await runAction(
      "rename",
      `${API}/api/dms/groups/${conversationId}`,
      { method: "PATCH", body: JSON.stringify({ name: cleanName }) },
      "Could not rename group"
    );
  };

  const changeGroupAvatar = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setError("Choose a valid image");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Group photos must be 10 MB or smaller");
      return;
    }
    const body = new FormData();
    body.append("file", file);
    await runAction(
      "avatar",
      `${API}/api/dms/groups/${conversationId}/avatar`,
      { method: "POST", body },
      "Could not update the group photo"
    );
  };

  const removeGroupAvatar = async () => {
    if (!window.confirm("Remove the current group photo?")) return;
    await runAction(
      "remove-avatar",
      `${API}/api/dms/groups/${conversationId}/avatar`,
      { method: "DELETE" },
      "Could not remove the group photo"
    );
  };

  const addPerson = async (person) => {
    const added = await runAction(
      `add-${person.id}`,
      `${API}/api/dms/groups/${conversationId}/members`,
      { method: "POST", body: JSON.stringify({ member_ids: [Number(person.id)] }) },
      "Could not add this person"
    );
    if (added) setCandidates((current) => current.filter((item) => Number(item.id) !== Number(person.id)));
  };

  const removeMember = async (member) => {
    if (!window.confirm(`Remove ${member.display_name || member.username} from this group?`)) return;
    await runAction(
      `remove-${member.user_id}`,
      `${API}/api/dms/groups/${conversationId}/members/${member.user_id}`,
      { method: "DELETE" },
      "Could not remove this member"
    );
  };

  const updateRole = async (member, role) => {
    const memberName = member.display_name || member.username;
    const confirmation = role === "admin"
      ? `Make ${memberName} a group admin? They will be able to add and remove members and change group settings.`
      : `Remove ${memberName}'s admin role? They will remain in the group as a member.`;
    if (!window.confirm(confirmation)) return;
    await runAction(
      `role-${member.user_id}`,
      `${API}/api/dms/groups/${conversationId}/members/${member.user_id}/role`,
      { method: "PATCH", body: JSON.stringify({ role }) },
      "Could not update this role"
    );
  };

  const leaveGroup = async () => {
    if (!window.confirm("Leave this group? You will stop receiving its messages.")) return;
    const left = await runAction(
      "leave",
      `${API}/api/dms/groups/${conversationId}/leave`,
      { method: "POST" },
      "Could not leave group",
      false
    );
    if (left) onLeft?.();
  };

  if (!open) return null;

  const groupAvatarUrl = group?.group_avatar_url || group?.avatar_url || "";
  const resolvedGroupAvatar = groupAvatarUrl
    ? (groupAvatarUrl.startsWith("http") ? groupAvatarUrl : `${API}${groupAvatarUrl}`)
    : "";

  return (
    <div className="dm-profile-sheet-backdrop" onClick={onClose}>
      <section className="dm-profile-sheet dm-group-sheet" onClick={(event) => event.stopPropagation()} aria-label="Group details">
        <button className="dm-profile-sheet-close" type="button" onClick={onClose} aria-label="Close" title="Close">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div className="dm-group-sheet-identity">
          <div className="dm-group-sheet-avatar-wrap">
            {resolvedGroupAvatar ? (
              <img
                className="dm-group-sheet-avatar"
                src={resolvedGroupAvatar}
                alt=""
                onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }}
              />
            ) : (
              <div className="dm-group-sheet-avatar">{String(group?.group_name || "G").slice(0, 2).toUpperCase()}</div>
            )}
            {group?.can_manage && (
              <button
                type="button"
                className="dm-group-avatar-change"
                onClick={() => avatarInputRef.current?.click()}
                disabled={Boolean(busyKey)}
                aria-label="Change group photo"
                title="Change group photo"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                  <path d="M4 8.5h3l1.4-2h7.2l1.4 2h3v10H4v-10Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.8" />
                </svg>
              </button>
            )}
            <input ref={avatarInputRef} className="dm-group-avatar-input" type="file" accept="image/*" onChange={changeGroupAvatar} />
          </div>
          <div className="dm-group-sheet-identity-copy">
            <h2>{group?.group_name || "Group chat"}</h2>
            <p>{Number(group?.member_count || 0)} members</p>
            {group?.can_manage && resolvedGroupAvatar && (
              <button type="button" className="dm-group-avatar-remove" onClick={removeGroupAvatar} disabled={Boolean(busyKey)}>
                {busyKey === "remove-avatar" ? "Removing..." : "Remove photo"}
              </button>
            )}
          </div>
        </div>

        {group?.can_manage && (
          <form className="dm-group-rename" onSubmit={renameGroup}>
            <label htmlFor="dm-group-rename-input">Group name</label>
            <div>
              <input id="dm-group-rename-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
              <button type="submit" disabled={busyKey === "rename" || name.trim() === group.group_name}>Save</button>
            </div>
          </form>
        )}

        <div className="dm-group-members-head">
          <div>
            <strong>People</strong>
            <span>{group?.viewer_role ? `You are ${group.viewer_role}` : ""}</span>
          </div>
          {group?.can_manage && (
            <button type="button" onClick={() => setShowAddPeople((current) => !current)}>
              {showAddPeople ? "Done" : "Add people"}
            </button>
          )}
        </div>

        {showAddPeople && (
          <div className="dm-group-add-panel">
            <div className="dm-group-add-search">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                <path d="m16 16 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" />
            </div>
            <div className="dm-group-add-results">
              {availableCandidates.length === 0 && <span>No more people found</span>}
              {availableCandidates.map((person) => (
                <button key={person.id} type="button" onClick={() => addPerson(person)} disabled={Boolean(busyKey)}>
                  <span>{person.display_name || person.username}</span>
                  <strong>{busyKey === `add-${person.id}` ? "Adding..." : "Add"}</strong>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="dm-group-member-list">
          {(group?.members || []).map((member) => {
            const avatar = member.avatar_url
              ? (member.avatar_url.startsWith("http") ? member.avatar_url : `${API}${member.avatar_url}`)
              : DEFAULT_AVATAR;
            const isMe = Number(member.user_id) === Number(currentUser?.id);
            const canRemove = group.can_manage && !isMe && member.role !== "owner" && !(group.viewer_role === "admin" && member.role === "admin");
            return (
              <div className="dm-group-member" key={member.user_id}>
                <img src={avatar} alt="" onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }} />
                <span className="dm-group-member-name">
                  <strong>{member.display_name || member.username}{isMe ? " (you)" : ""}</strong>
                  <small>@{member.username}</small>
                </span>
                <span className={`dm-group-role ${member.role}`}>{member.role}</span>
                {group.viewer_role === "owner" && !isMe && member.role !== "owner" && (
                  <button
                    type="button"
                    className="dm-group-role-action"
                    disabled={Boolean(busyKey)}
                    onClick={() => updateRole(member, member.role === "admin" ? "member" : "admin")}
                    title={member.role === "admin" ? "Remove admin role" : "Make admin"}
                  >
                    {member.role === "admin" ? "Remove admin" : "Make admin"}
                  </button>
                )}
                {canRemove && (
                  <button type="button" className="dm-group-remove" onClick={() => removeMember(member)} disabled={Boolean(busyKey)} aria-label={`Remove ${member.display_name || member.username}`} title="Remove member">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
                      <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {error && <div className="dm-group-sheet-error" role="alert">{error}</div>}
        {group && group.viewer_role !== "owner" && (
          <button type="button" className="dm-group-leave" onClick={leaveGroup} disabled={busyKey === "leave"}>
            {busyKey === "leave" ? "Leaving..." : "Leave group"}
          </button>
        )}
      </section>
    </div>
  );
}
