import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./VineSettings.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

export default function VineSettings() {
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");
  const me = (() => {
    try {
      return JSON.parse(localStorage.getItem("vine_user") || "{}");
    } catch {
      return {};
    }
  })();

  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [saveMsg, setSaveMsg] = useState("");
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [followRequests, setFollowRequests] = useState([]);

  const [privateProfile, setPrivateProfile] = useState(false);
  const [hideLikeCounts, setHideLikeCounts] = useState(false);
  const [showLastActive, setShowLastActive] = useState(true);
  const [aboutPrivacy, setAboutPrivacy] = useState("everyone");
  const [mentionsPrivacy, setMentionsPrivacy] = useState("everyone");
  const [tagsPrivacy, setTagsPrivacy] = useState("everyone");
  const [hideFromSearch, setHideFromSearch] = useState(false);

  const [notifInappLikes, setNotifInappLikes] = useState(true);
  const [notifInappComments, setNotifInappComments] = useState(true);
  const [notifInappMentions, setNotifInappMentions] = useState(true);
  const [notifInappMessages, setNotifInappMessages] = useState(true);
  const [notifEmailLikes, setNotifEmailLikes] = useState(false);
  const [notifEmailComments, setNotifEmailComments] = useState(false);
  const [notifEmailMentions, setNotifEmailMentions] = useState(true);
  const [notifEmailMessages, setNotifEmailMessages] = useState(false);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState("22:00");
  const [quietHoursEnd, setQuietHoursEnd] = useState("07:00");
  const [notifDigest, setNotifDigest] = useState("instant");

  const [mutedWords, setMutedWords] = useState("");
  const [autoplayMedia, setAutoplayMedia] = useState(true);
  const [blurSensitiveMedia, setBlurSensitiveMedia] = useState(false);

  const [twoFactorEmail, setTwoFactorEmail] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("vine_theme") === "dark");
  const [isVerified, setIsVerified] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [pinnedPostId, setPinnedPostId] = useState(null);
  const [deleteRequestedAt, setDeleteRequestedAt] = useState(null);
  const twoFactorTemporarilyDisabled = true;

  useEffect(() => {
    document.title = "Vine — Settings";
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", darkMode);
    localStorage.setItem("vine_theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const loadSessions = async () => {
    try {
      const res = await fetch(`${API}/api/vine/users/me/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => []);
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      setSessions([]);
    }
  };

  const loadBlockedUsers = async () => {
    try {
      const res = await fetch(`${API}/api/vine/users/me/blocks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => []);
      setBlockedUsers(Array.isArray(data) ? data : []);
    } catch {
      setBlockedUsers([]);
    }
  };

  const loadFollowRequests = async () => {
    try {
      const res = await fetch(`${API}/api/vine/users/me/follow-requests`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => []);
      setFollowRequests(Array.isArray(data) ? data : []);
    } catch {
      setFollowRequests([]);
    }
  };

  useEffect(() => {
    const load = async () => {
      if (!token || !me?.username) {
        setLoading(false);
        return;
      }
      try {
        const [profileRes, prefRes] = await Promise.all([
          fetch(`${API}/api/vine/users/${encodeURIComponent(me.username)}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/users/me/preferences`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        const profileData = await profileRes.json().catch(() => ({}));
        const prefData = await prefRes.json().catch(() => ({}));
        const user = profileData?.user || {};
        const pinned = (profileData?.posts || []).find((p) => Number(p.is_pinned) === 1);
        setPinnedPostId(pinned?.id || null);
        setIsVerified(Number(user.is_verified) === 1);

        setPrivateProfile(Boolean(prefData.is_private));
        setHideLikeCounts(Boolean(prefData.hide_like_counts));
        setShowLastActive(prefData.show_last_active !== 0);
        setAboutPrivacy(prefData.about_privacy || "everyone");
        setMentionsPrivacy(prefData.mentions_privacy || "everyone");
        setTagsPrivacy(prefData.tags_privacy || "everyone");
        setHideFromSearch(Boolean(prefData.hide_from_search));
        setTwoFactorEmail(Boolean(prefData.two_factor_email));

        setNotifInappLikes(prefData.notif_inapp_likes !== 0);
        setNotifInappComments(prefData.notif_inapp_comments !== 0);
        setNotifInappMentions(prefData.notif_inapp_mentions !== 0);
        setNotifInappMessages(prefData.notif_inapp_messages !== 0);
        setNotifEmailLikes(Boolean(prefData.notif_email_likes));
        setNotifEmailComments(Boolean(prefData.notif_email_comments));
        setNotifEmailMentions(prefData.notif_email_mentions !== 0);
        setNotifEmailMessages(Boolean(prefData.notif_email_messages));
        setQuietHoursEnabled(Boolean(prefData.quiet_hours_enabled));
        setQuietHoursStart(prefData.quiet_hours_start || "22:00");
        setQuietHoursEnd(prefData.quiet_hours_end || "07:00");
        setNotifDigest(prefData.notif_digest || "instant");

        setMutedWords(prefData.muted_words || "");
        setAutoplayMedia(prefData.autoplay_media !== 0);
        setBlurSensitiveMedia(Boolean(prefData.blur_sensitive_media));
        setDeleteRequestedAt(prefData.delete_requested_at || null);

        await Promise.all([loadSessions(), loadBlockedUsers(), loadFollowRequests()]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, me?.username]);

  const saveSettings = async (next) => {
    try {
      setSaveMsg("");
      const res = await fetch(`${API}/api/vine/users/me/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(next),
      });
      if (!res.ok) return;
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 1400);
    } catch {
      // ignore
    }
  };

  const logoutAllSessions = async () => {
    try {
      const res = await fetch(`${API}/api/vine/users/me/sessions/logout-all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        alert("Failed to log out sessions");
        return;
      }
      await loadSessions();
      alert("Logged out from other devices.");
    } catch {
      alert("Failed to log out sessions");
    }
  };

  const exportData = async (format = "json") => {
    try {
      const res = await fetch(`${API}/api/vine/users/me/export?format=${encodeURIComponent(format)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        alert("Export failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vine-export.${format === "csv" ? "csv" : "json"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      alert("Export failed");
    }
  };

  const deactivateAccount = async () => {
    if (!window.confirm("Deactivate your account now?")) return;
    try {
      const res = await fetch(`${API}/api/vine/users/me/deactivate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        alert("Deactivation failed");
        return;
      }
      alert("Account deactivated.");
      localStorage.removeItem("vine_token");
      localStorage.removeItem("vine_user");
      navigate("/vine/login");
    } catch {
      alert("Deactivation failed");
    }
  };

  const requestDeleteAccount = async () => {
    if (!window.confirm("Request account deletion?")) return;
    try {
      const res = await fetch(`${API}/api/vine/users/me/delete-request`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        alert("Delete request failed");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setDeleteRequestedAt(data?.delete_requested_at || new Date().toISOString());
      alert("Delete request submitted.");
    } catch {
      alert("Delete request failed");
    }
  };

  const cancelDeletion = async () => {
    try {
      const res = await fetch(`${API}/api/vine/users/me/cancel-deletion`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        alert("Failed to cancel deletion");
        return;
      }
      setDeleteRequestedAt(null);
      alert("Account deletion cancelled.");
    } catch {
      alert("Failed to cancel deletion");
    }
  };

  const deletionDueAt = deleteRequestedAt
    ? new Date(new Date(deleteRequestedAt).getTime() + 10 * 24 * 60 * 60 * 1000)
    : null;

  const changePassword = async () => {
    setPasswordMsg("");
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMsg("Please fill in all password fields.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg("New passwords do not match.");
      return;
    }
    try {
      const res = await fetch(`${API}/api/vine/users/me/change-password`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPasswordMsg(data?.message || "Password update failed.");
        return;
      }
      setPasswordMsg("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setPasswordMsg("Password update failed.");
    }
  };

  const requestVerification = async () => {
    setVerifyMsg("");
    if (!verifyEmail) {
      setVerifyMsg("Please enter your email.");
      return;
    }
    try {
      const res = await fetch(`${API}/api/vine/users/me/verify-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: verifyEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVerifyMsg(data?.message || "Failed to send verification code.");
        return;
      }
      setVerifyMsg("Verification code sent. Check your email.");
    } catch {
      setVerifyMsg("Failed to send verification code.");
    }
  };

  const confirmVerification = async () => {
    setVerifyMsg("");
    if (!verifyCode) {
      setVerifyMsg("Please enter the code.");
      return;
    }
    try {
      const res = await fetch(`${API}/api/vine/users/me/verify-email-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: verifyCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVerifyMsg(data?.message || "Verification failed.");
        return;
      }
      setVerifyMsg("Email verified. Checkmark unlocked.");
      setVerifyCode("");
      setIsVerified(true);
    } catch {
      setVerifyMsg("Verification failed.");
    }
  };

  const clearPinnedPost = async () => {
    if (!pinnedPostId) {
      alert("No pinned post found.");
      return;
    }
    try {
      const res = await fetch(`${API}/api/vine/posts/${pinnedPostId}/pin`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.message || "Failed to remove pinned post");
        return;
      }
      setPinnedPostId(null);
    } catch {
      alert("Failed to remove pinned post");
    }
  };

  const unblockUser = async (userId) => {
    try {
      const res = await fetch(`${API}/api/vine/users/${userId}/block`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        alert("Failed to unblock user");
        return;
      }
      setBlockedUsers((prev) => prev.filter((u) => Number(u.id) !== Number(userId)));
    } catch {
      alert("Failed to unblock user");
    }
  };

  const respondFollowRequest = async (requestId, action) => {
    try {
      const res = await fetch(`${API}/api/vine/users/follow-requests/${requestId}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.message || "Failed to respond to follow request");
        return;
      }
      setFollowRequests((prev) => prev.filter((r) => Number(r.id) !== Number(requestId)));
    } catch {
      alert("Failed to respond to follow request");
    }
  };

  if (loading) {
    return <div className="vine-settings-page">Loading settings...</div>;
  }

  return (
    <div className="vine-settings-page">
      <div className="vine-settings-top">
        <button className="vine-settings-back" onClick={() => navigate(`/vine/profile/${me?.username || ""}`)}>
          ← Back
        </button>
        <h2>Settings</h2>
        {saveMsg ? <span className="save-chip">{saveMsg}</span> : null}
      </div>
      <div className="vine-settings-shell">
        <div className="vine-settings-card">
          {deleteRequestedAt && deletionDueAt && (
            <div className="deletion-banner">
              <div className="deletion-title">Account deletion pending</div>
              <div className="deletion-copy">
                This account is scheduled for permanent deletion on {deletionDueAt.toLocaleString()}.
              </div>
              <button className="settings-primary-btn" onClick={cancelDeletion}>Cancel deletion</button>
            </div>
          )}

          <h3 className="settings-section-title">Security</h3>
          <div className="settings-item">
            <label>
              <input
                type="checkbox"
                checked={twoFactorEmail}
                disabled={twoFactorTemporarilyDisabled}
                onChange={(e) => {
                  if (twoFactorTemporarilyDisabled) return;
                  const value = e.target.checked;
                  setTwoFactorEmail(value);
                  saveSettings({ two_factor_email: value });
                }}
              />
              2FA via email code
            </label>
            {twoFactorTemporarilyDisabled && (
              <span className="settings-soft-note">Temporarily unavailable</span>
            )}
          </div>
          <div className="settings-item stack">
            <label>Active sessions</label>
            <div className="session-list">
              {sessions.map((s) => (
                <div className="session-row" key={s.id}>
                  <div className="session-device">{s.device_info || "Unknown device"} {s.is_current ? "• This device" : ""}</div>
                  <div className="session-meta">{s.ip_address || "-"} • Last seen {new Date(s.last_seen_at || s.created_at).toLocaleString()}</div>
                </div>
              ))}
              {sessions.length === 0 && <div className="settings-hint">No sessions found.</div>}
            </div>
            <button className="settings-primary-btn" onClick={logoutAllSessions}>Log out of other devices</button>
          </div>

          <h3 className="settings-section-title">Safety</h3>
          <div className="settings-item stack">
            <label>Blocked accounts</label>
            {blockedUsers.length === 0 ? (
              <div className="settings-hint">No blocked accounts.</div>
            ) : (
              <div className="settings-user-list">
                {blockedUsers.map((u) => (
                  <div className="settings-user-row" key={`blocked-${u.id}`}>
                    <button
                      className="settings-user-left"
                      type="button"
                      onClick={() => navigate(`/vine/profile/${u.username}`)}
                    >
                      <img
                        src={u.avatar_url || DEFAULT_AVATAR}
                        alt={u.username}
                        onError={(e) => {
                          e.currentTarget.src = DEFAULT_AVATAR;
                        }}
                      />
                      <span className="settings-user-meta">
                        <strong>{u.display_name || u.username}</strong>
                        <small>@{u.username}</small>
                      </span>
                    </button>
                    <button
                      className="danger-btn danger-outline"
                      type="button"
                      onClick={() => unblockUser(u.id)}
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="settings-item stack">
            <label>Follow requests</label>
            {followRequests.length === 0 ? (
              <div className="settings-hint">No pending follow requests.</div>
            ) : (
              <div className="settings-user-list">
                {followRequests.map((r) => (
                  <div className="settings-user-row" key={`follow-request-${r.id}`}>
                    <button
                      className="settings-user-left"
                      type="button"
                      onClick={() => navigate(`/vine/profile/${r.username}`)}
                    >
                      <img
                        src={r.avatar_url || DEFAULT_AVATAR}
                        alt={r.username}
                        onError={(e) => {
                          e.currentTarget.src = DEFAULT_AVATAR;
                        }}
                      />
                      <span className="settings-user-meta">
                        <strong>{r.display_name || r.username}</strong>
                        <small>@{r.username}</small>
                      </span>
                    </button>
                    <div className="settings-user-actions">
                      <button
                        className="settings-primary-btn"
                        type="button"
                        onClick={() => respondFollowRequest(r.id, "accept")}
                      >
                        Accept
                      </button>
                      <button
                        className="danger-btn danger-outline"
                        type="button"
                        onClick={() => respondFollowRequest(r.id, "reject")}
                      >
                        Refuse
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <h3 className="settings-section-title">Privacy</h3>
          <div className="settings-item">
            <label><input type="checkbox" checked={privateProfile} onChange={(e) => { const v = e.target.checked; setPrivateProfile(v); saveSettings({ is_private: v }); }} />Private profile</label>
          </div>
          <div className="settings-item">
            <label><input type="checkbox" checked={hideLikeCounts} onChange={(e) => { const v = e.target.checked; setHideLikeCounts(v); saveSettings({ hide_like_counts: v }); }} />Hide like counts</label>
          </div>
          <div className="settings-item">
            <label><input type="checkbox" checked={showLastActive} onChange={(e) => { const v = e.target.checked; setShowLastActive(v); saveSettings({ show_last_active: v }); }} />Show last active status</label>
          </div>
          <div className="settings-item">
            <label><input type="checkbox" checked={hideFromSearch} onChange={(e) => { const v = e.target.checked; setHideFromSearch(v); saveSettings({ hide_from_search: v }); }} />Hide profile from search</label>
          </div>
          <div className="settings-item stack">
            <label>Who can mention me</label>
            <select value={mentionsPrivacy} onChange={(e) => { const v = e.target.value; setMentionsPrivacy(v); saveSettings({ mentions_privacy: v }); }}>
              <option value="everyone">Everyone</option>
              <option value="followers">Followers only</option>
              <option value="no_one">No one</option>
            </select>
          </div>
          <div className="settings-item stack">
            <label>Who can tag me</label>
            <select value={tagsPrivacy} onChange={(e) => { const v = e.target.value; setTagsPrivacy(v); saveSettings({ tags_privacy: v }); }}>
              <option value="everyone">Everyone</option>
              <option value="followers">Followers only</option>
              <option value="no_one">No one</option>
            </select>
          </div>
          <div className="settings-item stack">
            <label>Who can see my about</label>
            <select value={aboutPrivacy} onChange={(e) => { const v = e.target.value; setAboutPrivacy(v); saveSettings({ about_privacy: v }); }}>
              <option value="everyone">Everyone</option>
              <option value="followers">Followers only</option>
              <option value="no_one">No one</option>
            </select>
          </div>
          <h3 className="settings-section-title">Notifications</h3>
          <div className="settings-grid">
            <label><input type="checkbox" checked={notifInappLikes} onChange={(e) => { const v = e.target.checked; setNotifInappLikes(v); saveSettings({ notif_inapp_likes: v }); }} /> In-app Likes</label>
            <label><input type="checkbox" checked={notifInappComments} onChange={(e) => { const v = e.target.checked; setNotifInappComments(v); saveSettings({ notif_inapp_comments: v }); }} /> In-app Comments</label>
            <label><input type="checkbox" checked={notifInappMentions} onChange={(e) => { const v = e.target.checked; setNotifInappMentions(v); saveSettings({ notif_inapp_mentions: v }); }} /> In-app Mentions</label>
            <label><input type="checkbox" checked={notifInappMessages} onChange={(e) => { const v = e.target.checked; setNotifInappMessages(v); saveSettings({ notif_inapp_messages: v }); }} /> In-app Messages</label>
            <label><input type="checkbox" checked={notifEmailLikes} onChange={(e) => { const v = e.target.checked; setNotifEmailLikes(v); saveSettings({ notif_email_likes: v }); }} /> Email Likes</label>
            <label><input type="checkbox" checked={notifEmailComments} onChange={(e) => { const v = e.target.checked; setNotifEmailComments(v); saveSettings({ notif_email_comments: v }); }} /> Email Comments</label>
            <label><input type="checkbox" checked={notifEmailMentions} onChange={(e) => { const v = e.target.checked; setNotifEmailMentions(v); saveSettings({ notif_email_mentions: v }); }} /> Email Mentions</label>
            <label><input type="checkbox" checked={notifEmailMessages} onChange={(e) => { const v = e.target.checked; setNotifEmailMessages(v); saveSettings({ notif_email_messages: v }); }} /> Email Messages</label>
          </div>
          <div className="settings-item">
            <label><input type="checkbox" checked={quietHoursEnabled} onChange={(e) => { const v = e.target.checked; setQuietHoursEnabled(v); saveSettings({ quiet_hours_enabled: v }); }} /> Quiet hours</label>
          </div>
          <div className="settings-inline-row">
            <input type="time" value={quietHoursStart} onChange={(e) => { const v = e.target.value; setQuietHoursStart(v); saveSettings({ quiet_hours_start: v }); }} />
            <span>to</span>
            <input type="time" value={quietHoursEnd} onChange={(e) => { const v = e.target.value; setQuietHoursEnd(v); saveSettings({ quiet_hours_end: v }); }} />
          </div>
          <div className="settings-item stack">
            <label>Digest mode</label>
            <select value={notifDigest} onChange={(e) => { const v = e.target.value; setNotifDigest(v); saveSettings({ notif_digest: v }); }}>
              <option value="instant">Instant</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
            </select>
          </div>

          <h3 className="settings-section-title">Content Controls</h3>
          <div className="settings-item">
            <label><input type="checkbox" checked={autoplayMedia} onChange={(e) => { const v = e.target.checked; setAutoplayMedia(v); saveSettings({ autoplay_media: v }); }} /> Auto-play media</label>
          </div>
          <div className="settings-item">
            <label><input type="checkbox" checked={blurSensitiveMedia} onChange={(e) => { const v = e.target.checked; setBlurSensitiveMedia(v); saveSettings({ blur_sensitive_media: v }); }} /> Blur sensitive media</label>
          </div>
          <div className="settings-item stack">
            <label>Muted words/phrases (comma-separated)</label>
            <textarea
              className="settings-textarea"
              value={mutedWords}
              onChange={(e) => setMutedWords(e.target.value)}
              onBlur={() => saveSettings({ muted_words: mutedWords })}
              placeholder="word1, phrase2, spoiler"
            />
          </div>

          <h3 className="settings-section-title">Account Management</h3>
          <div className="settings-inline-row">
            <button className="settings-primary-btn" onClick={() => exportData("json")}>Download Data (JSON)</button>
            <button className="settings-primary-btn" onClick={() => exportData("csv")}>Download Data (CSV)</button>
          </div>
          <div className="settings-inline-row">
            <button className="danger-btn" onClick={deactivateAccount}>Deactivate account</button>
            <button className="danger-btn danger-outline" onClick={requestDeleteAccount}>Delete account request</button>
          </div>

          <h3 className="settings-section-title">Core</h3>
          <div className="settings-item">
            <label><input type="checkbox" checked={darkMode} onChange={(e) => setDarkMode(e.target.checked)} />Dark mode</label>
          </div>
          <div className="settings-item stack">
            <label>Change password</label>
            <input className="settings-input" type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            <input className="settings-input" type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <input className="settings-input" type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            <button className="settings-primary-btn" onClick={changePassword}>Update password</button>
            {passwordMsg && <div className="settings-hint">{passwordMsg}</div>}
          </div>
          <div className="settings-item stack">
            <label>Verify email</label>
            <input className="settings-input" type="email" placeholder="Enter your email" value={verifyEmail} onChange={(e) => setVerifyEmail(e.target.value)} />
            <button className="settings-primary-btn" onClick={requestVerification}>Send verification code</button>
            <input className="settings-input" type="text" placeholder="Enter 4-digit code" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} />
            <button className="settings-primary-btn" onClick={confirmVerification}>Verify code</button>
            {isVerified && <div className="settings-hint">✅ Verified</div>}
            {verifyMsg && <div className="settings-hint">{verifyMsg}</div>}
          </div>
          <div className="settings-item danger">
            <button className="danger-btn" onClick={clearPinnedPost}>Remove pinned post</button>
          </div>
        </div>
      </div>
    </div>
  );
}
