import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./GroupDetailsSheet.css";
import useGroupCandidates from "./useGroupCandidates";
import { CHAT_THEMES } from "./chatThemes";
import { getVineAvatarThumbnailUrl, useDefaultVineAvatarOnError } from "../../modules/vine/utils/vineAvatar";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";
const MEDIA_FILTERS = [
  { value: "all", label: "All" },
  { value: "image", label: "Photos" },
  { value: "video", label: "Videos" },
  { value: "voice", label: "Audio" },
];

const formatDate = (value) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const getActivityLabel = (member) => {
  if (Number(member?.is_online_now) === 1) return "Active now";
  if (Number(member?.is_recently_active) === 1) return "Active recently";
  return "";
};

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
    <path d="m16 16 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export default function GroupDetailsSheet({
  open,
  conversationId,
  onClose,
  onChanged,
  onLeft,
  onDeleted,
}) {
  const token = localStorage.getItem("vine_token");
  const currentUser = JSON.parse(localStorage.getItem("vine_user"));
  const onChangedRef = useRef(onChanged);
  const avatarInputRef = useRef(null);
  const [group, setGroup] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [showAddPeople, setShowAddPeople] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaCursor, setMediaCursor] = useState(null);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [mediaFilter, setMediaFilter] = useState("all");
  const [copied, setCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const directory = useGroupCandidates({
    enabled: open && showAddPeople && Boolean(group?.can_manage), query, token, conversationId,
    revision: (group?.members || []).map((member) => member.user_id).join(","),
  });

  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);

  const applyGroup = useCallback((data) => {
    setGroup(data);
    setName(data.group_name || "");
    setDescription(data.group_description || "");
    onChangedRef.current?.(data);
  }, []);

  const loadGroup = useCallback(async () => {
    const response = await fetch(`${API}/api/dms/groups/${conversationId}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not load group");
    applyGroup(data);
    return data;
  }, [applyGroup, conversationId, token]);

  useEffect(() => {
    if (!open || !conversationId) return;
    setError("");
    setMemberQuery("");
    setShowMedia(false);
    setMediaItems([]);
    setMediaCursor(null);
    setMediaLoaded(false);
    setShowDeleteConfirm(false);
    loadGroup().catch((requestError) => setError(requestError?.message || "Could not load group"));
  }, [open, conversationId, loadGroup]);

  const memberIds = useMemo(() => new Set((group?.members || []).map((member) => Number(member.user_id))), [group]);
  const availableCandidates = directory.people.filter((person) => !memberIds.has(Number(person.id)));
  const visibleMembers = useMemo(() => {
    const cleanQuery = memberQuery.trim().toLowerCase();
    if (!cleanQuery) return group?.members || [];
    return (group?.members || []).filter((member) =>
      `${member.display_name || ""} ${member.username || ""} ${member.role || ""}`.toLowerCase().includes(cleanQuery)
    );
  }, [group?.members, memberQuery]);
  const visibleMedia = mediaFilter === "all" ? mediaItems : mediaItems.filter((item) => item.media_type === mediaFilter);

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
      if (data?.conversation_type === "group") applyGroup(data);
      else if (refreshAfter) await loadGroup();
      return data;
    } catch (requestError) {
      setError(requestError?.message || fallbackError);
      return null;
    } finally {
      setBusyKey("");
    }
  };

  const saveGroupDetails = async (event) => {
    event.preventDefault();
    const cleanName = name.replace(/\s+/g, " ").trim();
    const cleanDescription = description.replace(/\s+/g, " ").trim();
    if (cleanName.length < 2) return setError("Group name must have at least 2 characters");
    const payload = {};
    if (cleanName !== group?.group_name) payload.name = cleanName;
    if (cleanDescription !== (group?.group_description || "")) payload.description = cleanDescription;
    if (!Object.keys(payload).length) return;
    await runAction("details", `${API}/api/dms/groups/${conversationId}`, { method: "PATCH", body: JSON.stringify(payload) }, "Could not update group details");
  };

  const savePreference = async (key, value) => {
    await runAction(`preference-${key}`, `${API}/api/dms/groups/${conversationId}/preferences`, { method: "PATCH", body: JSON.stringify({ [key]: value }) }, "Could not update your group preference");
  };

  const loadMedia = useCallback(async (before = null) => {
    if (!conversationId || mediaLoading) return;
    setMediaLoading(true);
    setMediaError("");
    try {
      const suffix = before ? `?before=${encodeURIComponent(before)}` : "";
      const response = await fetch(`${API}/api/dms/groups/${conversationId}/media${suffix}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load shared media");
      setMediaItems((current) => before ? [...current, ...(data.items || [])] : (data.items || []));
      setMediaCursor(data.next_before || null);
      setMediaLoaded(true);
    } catch (requestError) {
      setMediaError(requestError?.message || "Could not load shared media");
    } finally {
      setMediaLoading(false);
    }
  }, [conversationId, mediaLoading, token]);

  const toggleMedia = () => {
    setShowMedia((current) => !current);
    if (!mediaLoaded && !mediaLoading) loadMedia();
  };

  const copyGroupDetails = async () => {
    const creator = group?.created_by_user;
    const lines = [group?.group_name || "Group chat", group?.group_description || "", `${Number(group?.member_count || 0)} members`, creator ? `Created by @${creator.username}` : "", group?.created_at ? `Created ${formatDate(group.created_at)}` : ""].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setError("Could not copy group details"); }
  };

  const changeGroupAvatar = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) return setError("Choose a valid image");
    if (file.size > 10 * 1024 * 1024) return setError("Group photos must be 10 MB or smaller");
    const body = new FormData();
    body.append("file", file);
    await runAction("avatar", `${API}/api/dms/groups/${conversationId}/avatar`, { method: "POST", body }, "Could not update the group photo");
  };

  const removeGroupAvatar = async () => {
    if (!window.confirm("Remove the current group photo?")) return;
    await runAction("remove-avatar", `${API}/api/dms/groups/${conversationId}/avatar`, { method: "DELETE" }, "Could not remove the group photo");
  };
  const addPerson = (person) => runAction(`add-${person.id}`, `${API}/api/dms/groups/${conversationId}/members`, { method: "POST", body: JSON.stringify({ member_ids: [Number(person.id)] }) }, "Could not add this person");
  const removeMember = async (member) => {
    if (!window.confirm(`Remove ${member.display_name || member.username} from this group?`)) return;
    await runAction(`remove-${member.user_id}`, `${API}/api/dms/groups/${conversationId}/members/${member.user_id}`, { method: "DELETE" }, "Could not remove this member");
  };
  const updateRole = async (member, role) => {
    const memberName = member.display_name || member.username;
    const confirmation = role === "admin" ? `Make ${memberName} a group admin? They will be able to add and remove members and change group settings.` : `Remove ${memberName}'s admin role? They will remain in the group as a member.`;
    if (!window.confirm(confirmation)) return;
    await runAction(`role-${member.user_id}`, `${API}/api/dms/groups/${conversationId}/members/${member.user_id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }, "Could not update this role");
  };
  const leaveGroup = async () => {
    if (!window.confirm("Leave this group? You will stop receiving its messages.")) return;
    const left = await runAction("leave", `${API}/api/dms/groups/${conversationId}/leave`, { method: "POST" }, "Could not leave group", false);
    if (left) onLeft?.();
  };
  const deleteGroup = async () => {
    const deleted = await runAction(
      "delete-group",
      `${API}/api/dms/groups/${conversationId}`,
      { method: "DELETE" },
      "Could not delete group",
      false
    );
    if (!deleted) return;
    setShowDeleteConfirm(false);
    onDeleted?.();
  };

  if (!open) return null;
  const groupAvatarUrl = group?.group_avatar_url || group?.avatar_url || "";
  const resolvedGroupAvatar = groupAvatarUrl ? (groupAvatarUrl.startsWith("http") ? groupAvatarUrl : `${API}${groupAvatarUrl}`) : "";
  const detailsChanged = name.replace(/\s+/g, " ").trim() !== (group?.group_name || "") || description.replace(/\s+/g, " ").trim() !== (group?.group_description || "");

  return createPortal(
    <div className="dm-profile-sheet-backdrop dm-group-sheet-backdrop" onClick={onClose}>
      <section className="dm-profile-sheet dm-group-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Group details">
        <button className="dm-profile-sheet-close" type="button" onClick={onClose} aria-label="Close" title="Close"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>

        <div className="dm-group-sheet-identity">
          <div className="dm-group-sheet-avatar-wrap">
            {resolvedGroupAvatar ? <img className="dm-group-sheet-avatar" src={resolvedGroupAvatar} alt="" onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }} /> : <div className="dm-group-sheet-avatar">{String(group?.group_name || "G").slice(0, 2).toUpperCase()}</div>}
            {group?.can_manage && <button type="button" className="dm-group-avatar-change" onClick={() => avatarInputRef.current?.click()} disabled={Boolean(busyKey)} aria-label="Change group photo" title="Change group photo"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M4 8.5h3l1.4-2h7.2l1.4 2h3v10H4v-10Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.8" /></svg></button>}
            <input ref={avatarInputRef} className="dm-group-avatar-input" type="file" accept="image/*" onChange={changeGroupAvatar} />
          </div>
          <div className="dm-group-sheet-identity-copy">
            <span className="dm-group-sheet-kicker">Group details</span>
            <h2>{group?.group_name || "Group chat"}</h2>
            <p>{Number(group?.member_count || 0)} members <span aria-hidden="true">·</span> {Number(group?.recently_active_count || 0)} active recently</p>
            {group?.group_description && <div className="dm-group-description-display">{group.group_description}</div>}
            <div className="dm-group-identity-actions">
              <button type="button" className="dm-group-copy" onClick={copyGroupDetails}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.8" /></svg>{copied ? "Copied" : "Copy details"}</button>
              {group?.can_manage && resolvedGroupAvatar && <button type="button" className="dm-group-avatar-remove" onClick={removeGroupAvatar} disabled={Boolean(busyKey)}>{busyKey === "remove-avatar" ? "Removing..." : "Remove photo"}</button>}
            </div>
          </div>
        </div>

        <div className="dm-group-created-info"><span>Created {formatDate(group?.created_at)}</span>{group?.created_by_user && <span>by @{group.created_by_user.username}</span>}</div>

        {group?.can_manage && <form className="dm-group-details-form" onSubmit={saveGroupDetails}>
          <label htmlFor="dm-group-name-input">Group name</label>
          <input id="dm-group-name-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          <div className="dm-group-description-heading">
            <label htmlFor="dm-group-description-input">Description</label>
            <span>Let members know what this group is about</span>
          </div>
          <div className="dm-group-description-field">
            <textarea id="dm-group-description-input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} rows={4} placeholder="Write a short description for your group…" aria-describedby="dm-group-description-count" />
            <span id="dm-group-description-count" className={`dm-group-description-count ${description.length >= 270 ? "near-limit" : ""}`}>{description.length}/300</span>
          </div>
          <button type="submit" disabled={busyKey === "details" || !detailsChanged}>{busyKey === "details" ? "Saving..." : "Save details"}</button>
        </form>}

        <section className="dm-group-preferences" aria-label="Your group preferences">
          <div className="dm-group-setting-row"><div><strong>Mute notifications</strong><span>Messages stay in your inbox without off-chat alerts.</span></div><button type="button" className={`dm-group-toggle ${group?.notifications_muted ? "on" : ""}`} onClick={() => savePreference("notifications_muted", !group?.notifications_muted)} disabled={busyKey === "preference-notifications_muted"} role="switch" aria-checked={Boolean(group?.notifications_muted)} aria-label="Mute group notifications"><span /></button></div>
          <div className="dm-group-theme-setting"><div><strong>Group theme</strong><span>Choose how this chat looks for you.</span></div><div className="dm-group-theme-swatches">{CHAT_THEMES.map((theme) => <button key={theme.value} type="button" className={group?.theme_color === theme.value ? "active" : ""} onClick={() => savePreference("theme_color", theme.value)} disabled={Boolean(busyKey)} aria-label={`${theme.label} theme`} title={theme.label}><span style={{ backgroundColor: theme.color }} /><small>{theme.label}</small></button>)}</div></div>
        </section>

        <section className="dm-group-media-section">
          <button type="button" className="dm-group-section-toggle" onClick={toggleMedia} aria-expanded={showMedia}><span><strong>Shared media</strong><small>Photos, videos, and voice notes</small></span><svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true" className={showMedia ? "open" : ""}><path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          {showMedia && <div className="dm-group-media-content">
            <div className="dm-group-media-filters">{MEDIA_FILTERS.map((filter) => <button key={filter.value} type="button" className={mediaFilter === filter.value ? "active" : ""} onClick={() => setMediaFilter(filter.value)}>{filter.label}</button>)}</div>
            {mediaLoading && !mediaLoaded && <div className="dm-group-media-state">Loading shared media...</div>}
            {mediaError && <div className="dm-group-media-state error" role="alert">{mediaError}</div>}
            {mediaLoaded && visibleMedia.length === 0 && <div className="dm-group-media-state">No {mediaFilter === "all" ? "shared media" : MEDIA_FILTERS.find((item) => item.value === mediaFilter)?.label.toLowerCase()} yet.</div>}
            {visibleMedia.length > 0 && <div className="dm-group-media-grid">{visibleMedia.map((item) => <article key={item.id} className={`dm-group-media-item ${item.media_type}`}>
              {item.media_type === "image" && <a href={item.media_url} target="_blank" rel="noreferrer"><img src={item.media_url} alt={`Shared by ${item.display_name || item.username}`} loading="lazy" /></a>}
              {item.media_type === "video" && <video src={item.media_url} controls playsInline preload="metadata" />}
              {item.media_type === "voice" && <div className="dm-group-media-audio"><span>Voice note</span><audio src={item.media_url} controls preload="none" /></div>}
              <footer><strong>{item.display_name || item.username}</strong><time dateTime={item.created_at}>{formatDate(item.created_at)}</time></footer>
            </article>)}</div>}
            {mediaCursor && <button type="button" className="dm-group-media-more" onClick={() => loadMedia(mediaCursor)} disabled={mediaLoading}>{mediaLoading ? "Loading..." : "Show more"}</button>}
          </div>}
        </section>

        <div className="dm-group-members-head"><div><strong>People</strong><span>{group?.viewer_role ? `You are ${group.viewer_role}` : ""}</span></div>{group?.can_manage && <button type="button" onClick={() => setShowAddPeople((current) => !current)}>{showAddPeople ? "Done" : "Add people"}</button>}</div>

        {showAddPeople && <div className="dm-group-add-panel"><div className="dm-group-add-search"><SearchIcon /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all of Vine" aria-label="Search all of Vine" maxLength={80} /></div><div className="dm-group-add-results">
          {directory.loading && <span role="status">Searching Vine...</span>}{directory.error && <span role="alert">{directory.error}</span>}
          {!directory.loading && !directory.error && availableCandidates.length === 0 && <span>No people found{query.trim() ? ` for "${query.trim()}"` : ""}</span>}
          {availableCandidates.map((person) => <button key={person.id} type="button" onClick={() => addPerson(person)} disabled={Boolean(busyKey)}><img src={getVineAvatarThumbnailUrl(person.avatar_url)} alt="" onError={useDefaultVineAvatarOnError} loading="lazy" /><span className="dm-group-candidate-name"><b>{person.display_name || person.username}</b><small>@{person.username}</small></span><strong className="dm-group-candidate-add">{busyKey === `add-${person.id}` ? "Adding..." : "Add"}</strong></button>)}
          {directory.hasMore && <button type="button" className="dm-group-load-more" onClick={directory.loadMore} disabled={directory.loading}>Show more people</button>}
        </div></div>}

        <div className="dm-group-member-search"><SearchIcon /><input type="search" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Search members" aria-label="Search group members" /></div>
        <div className="dm-group-member-list">
          {visibleMembers.map((member) => {
            const avatar = member.avatar_url ? (member.avatar_url.startsWith("http") ? member.avatar_url : `${API}${member.avatar_url}`) : DEFAULT_AVATAR;
            const isMe = Number(member.user_id) === Number(currentUser?.id);
            const canRemove = group.can_manage && !isMe && member.role !== "owner" && !(group.viewer_role === "admin" && member.role === "admin");
            const activityLabel = getActivityLabel(member);
            return <div className="dm-group-member" key={member.user_id}>
              <span className="dm-group-member-avatar"><img src={avatar} alt="" onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }} />{Number(member.is_online_now) === 1 && <i aria-label="Active now" />}</span>
              <span className="dm-group-member-name"><strong>{member.display_name || member.username}{isMe ? " (you)" : ""}</strong><small>@{member.username} · Joined {formatDate(member.joined_at)}</small>{activityLabel && <em>{activityLabel}</em>}</span>
              <span className={`dm-group-role ${member.role}`}>{member.role}</span>
              {group.viewer_role === "owner" && !isMe && member.role !== "owner" && <button type="button" className="dm-group-role-action" disabled={Boolean(busyKey)} onClick={() => updateRole(member, member.role === "admin" ? "member" : "admin")} title={member.role === "admin" ? "Remove admin role" : "Make admin"}>{member.role === "admin" ? "Remove admin" : "Make admin"}</button>}
              {canRemove && <button type="button" className="dm-group-remove" onClick={() => removeMember(member)} disabled={Boolean(busyKey)} aria-label={`Remove ${member.display_name || member.username}`} title="Remove member"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>}
            </div>;
          })}
          {visibleMembers.length === 0 && <div className="dm-group-member-empty">No members match “{memberQuery.trim()}”.</div>}
        </div>
        {group?.viewer_role === "owner" && <section className="dm-group-danger-zone" aria-label="Delete group">
          <div className="dm-group-danger-copy">
            <span className="dm-group-danger-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            <span><strong>Delete group</strong><small>Permanently dissolve this group for every member.</small></span>
          </div>
          <button type="button" className="dm-group-delete" onClick={() => { setError(""); setShowDeleteConfirm(true); }} disabled={Boolean(busyKey)}>Delete group</button>
        </section>}
        {error && <div className="dm-group-sheet-error" role="alert">{error}</div>}
        {group && group.viewer_role !== "owner" && <button type="button" className="dm-group-leave" onClick={leaveGroup} disabled={busyKey === "leave"}>{busyKey === "leave" ? "Leaving..." : "Leave group"}</button>}
      </section>
      {showDeleteConfirm && <div className="dm-group-delete-confirm-backdrop" role="presentation" onClick={(event) => { event.stopPropagation(); if (busyKey !== "delete-group") setShowDeleteConfirm(false); }}>
        <div className="dm-group-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="dm-group-delete-title" aria-describedby="dm-group-delete-copy" onClick={(event) => event.stopPropagation()}>
          <span className="dm-group-delete-confirm-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <span className="dm-group-delete-confirm-kicker">Owner action</span>
          <h3 id="dm-group-delete-title">Delete {group?.group_name || "this group"}?</h3>
          <p id="dm-group-delete-copy">The group, its messages, and shared media will be permanently removed for everyone. This cannot be undone.</p>
          {error && <div className="dm-group-delete-confirm-error" role="alert">{error}</div>}
          <div className="dm-group-delete-confirm-actions">
            <button type="button" autoFocus onClick={() => setShowDeleteConfirm(false)} disabled={busyKey === "delete-group"}>Keep group</button>
            <button type="button" className="danger" onClick={deleteGroup} disabled={busyKey === "delete-group"}>{busyKey === "delete-group" ? "Deleting..." : "Delete group"}</button>
          </div>
        </div>
      </div>}
    </div>, document.body
  );
}
