import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import VinePostCard from "./VinePostCard";
import "./VineCommunities.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const parseAnswers = (value) => {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export default function VineCommunities() {
  const token = localStorage.getItem("vine_token");
  const navigate = useNavigate();
  const { slug } = useParams();
  const DEFAULT_AVATAR = "/default-avatar.png";
  const [communities, setCommunities] = useState([]);
  const [activeCommunity, setActiveCommunity] = useState(null);
  const [posts, setPosts] = useState([]);
  const [members, setMembers] = useState([]);
  const [activeTab, setActiveTab] = useState("discussion");
  const [joinPolicy, setJoinPolicy] = useState("open");
  const [postPermission, setPostPermission] = useState("all");
  const [autoWelcomeEnabled, setAutoWelcomeEnabled] = useState(true);
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [pendingRequests, setPendingRequests] = useState([]);
  const [postText, setPostText] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState("");
  const [questions, setQuestions] = useState([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [events, setEvents] = useState([]);
  const [eventTitle, setEventTitle] = useState("");
  const [eventStartsAt, setEventStartsAt] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [mediaPosts, setMediaPosts] = useState([]);
  const [reputation, setReputation] = useState([]);
  const [reports, setReports] = useState([]);
  const [topicFilter, setTopicFilter] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [communityAvatarFile, setCommunityAvatarFile] = useState(null);
  const [communityBannerFile, setCommunityBannerFile] = useState(null);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);

  const loadCommunities = async () => {
    try {
      const res = await fetch(`${API}/api/vine/communities`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setCommunities(Array.isArray(data) ? data : []);
    } catch {
      setCommunities([]);
    }
  };

  const loadCommunityDetail = async (communitySlug, nextTopic = "") => {
    if (!communitySlug) {
      setActiveCommunity(null);
      setPosts([]);
      return;
    }
    try {
      const cRes = await fetch(`${API}/api/vine/communities/${encodeURIComponent(communitySlug)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cData = await cRes.json().catch(() => null);
      if (!cRes.ok || !cData?.id) {
        setActiveCommunity(null);
        setPosts([]);
        setMembers([]);
        setRules([]);
        setQuestions([]);
        setEvents([]);
        setMediaPosts([]);
        return;
      }

      const [pRes, mRes, rulesRes, questionsRes, eventsRes, mediaRes] = await Promise.all([
        fetch(
          `${API}/api/vine/communities/${encodeURIComponent(communitySlug)}/posts${nextTopic ? `?topic=${encodeURIComponent(nextTopic)}` : ""}`,
          { headers: { Authorization: `Bearer ${token}` } }
        ),
        fetch(`${API}/api/vine/communities/${encodeURIComponent(communitySlug)}/members?limit=24`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API}/api/vine/communities/${cData.id}/rules`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API}/api/vine/communities/${cData.id}/questions`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API}/api/vine/communities/${encodeURIComponent(communitySlug)}/events`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API}/api/vine/communities/${encodeURIComponent(communitySlug)}/media`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const pData = await pRes.json().catch(() => []);
      const mData = await mRes.json().catch(() => []);
      const rulesData = await rulesRes.json().catch(() => []);
      const qData = await questionsRes.json().catch(() => []);
      const eventsData = await eventsRes.json().catch(() => []);
      const mediaData = await mediaRes.json().catch(() => []);
      setActiveCommunity(cData);
      setPosts(Array.isArray(pData) ? pData : []);
      setMembers(Array.isArray(mData) ? mData : []);
      setRules(Array.isArray(rulesData) ? rulesData : []);
      setQuestions(Array.isArray(qData) ? qData : []);
      setEvents(Array.isArray(eventsData) ? eventsData : []);
      setMediaPosts(Array.isArray(mediaData) ? mediaData : []);
      setJoinPolicy(cData?.join_policy || "open");
      setPostPermission(cData?.post_permission || "all");
      setAutoWelcomeEnabled(Number(cData?.auto_welcome_enabled ?? 1) === 1);
      setWelcomeMessage(cData?.welcome_message || "");
    } catch {
      setActiveCommunity(null);
      setPosts([]);
      setMembers([]);
      setRules([]);
      setQuestions([]);
      setEvents([]);
      setMediaPosts([]);
    }
  };

  useEffect(() => {
    loadCommunities();
  }, []);

  useEffect(() => {
    loadCommunityDetail(slug, topicFilter);
  }, [slug, topicFilter]);

  const createCommunity = async () => {
    const trimmedName = name.trim();
    if (trimmedName.length < 3) {
      alert("Community name must be at least 3 characters");
      return;
    }
    try {
      const res = await fetch(`${API}/api/vine/communities`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to create community");
        return;
      }
      setName("");
      setDescription("");
      await loadCommunities();
      navigate(`/vine/communities/${data.slug}`);
    } catch {
      alert("Failed to create community");
    }
  };

  const toggleJoin = async (community) => {
    try {
      if (String(community.join_request_status || "") === "pending" && Number(community.is_member) !== 1) {
        return;
      }
      const isMember = Number(community.is_member) === 1;
      let answers = [];
      if (!isMember && String(community.join_policy || "") === "approval") {
        try {
          const qRes = await fetch(`${API}/api/vine/communities/${community.id}/questions`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const qData = await qRes.json().catch(() => []);
          if (Array.isArray(qData) && qData.length > 0) {
            answers = qData.map((q) => window.prompt(q.question_text || "Answer") || "").filter((x) => String(x).trim() !== "");
          }
        } catch {
          answers = [];
        }
      }
      const res = await fetch(`${API}/api/vine/communities/${community.id}/${isMember ? "leave" : "join"}`, {
        method: isMember ? "DELETE" : "POST",
        headers: isMember
          ? { Authorization: `Bearer ${token}` }
          : {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
        body: isMember ? undefined : JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || "Action failed");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.status === "pending") {
        alert("Join request sent. Waiting for admin approval.");
      }
      await loadCommunities();
      if (activeCommunity?.id === community.id) {
        await loadCommunityDetail(community.slug);
      }
    } catch {
      // no-op
    }
  };

  const loadRequests = async () => {
    if (!activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/requests`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setPendingRequests(Array.isArray(data) ? data : []);
    } catch {
      setPendingRequests([]);
    }
  };

  const loadScheduledPosts = async () => {
    if (!activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/scheduled-posts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setScheduledPosts(Array.isArray(data) ? data : []);
    } catch {
      setScheduledPosts([]);
    }
  };

  const loadReputation = async () => {
    if (!activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/reputation`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setReputation(Array.isArray(data) ? data : []);
    } catch {
      setReputation([]);
    }
  };

  const loadReports = async () => {
    if (!activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/reports`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setReports(Array.isArray(data) ? data : []);
    } catch {
      setReports([]);
    }
  };

  useEffect(() => {
    if (activeTab === "settings" && activeCommunity && ["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase())) {
      loadRequests();
      loadScheduledPosts();
    }
  }, [activeTab, activeCommunity?.id, activeCommunity?.viewer_role]);

  useEffect(() => {
    if (activeTab === "reputation" && activeCommunity?.id) loadReputation();
    if (activeTab === "reports" && activeCommunity && ["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase())) {
      loadReports();
    }
  }, [activeTab, activeCommunity?.id, activeCommunity?.viewer_role]);

  const saveSettings = async () => {
    if (!activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          join_policy: joinPolicy,
          post_permission: postPermission,
          auto_welcome_enabled: autoWelcomeEnabled ? 1 : 0,
          welcome_message: welcomeMessage,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to save settings");
        return;
      }
      setActiveCommunity((prev) =>
        prev
          ? {
              ...prev,
              join_policy: joinPolicy,
              post_permission: postPermission,
              auto_welcome_enabled: autoWelcomeEnabled ? 1 : 0,
              welcome_message: welcomeMessage,
            }
          : prev
      );
      await loadCommunities();
      alert("Group settings saved");
    } catch {
      alert("Failed to save settings");
    }
  };

  const uploadCommunityAvatar = async () => {
    if (!activeCommunity?.id || !communityAvatarFile) return;
    const formData = new FormData();
    formData.append("avatar", communityAvatarFile);
    const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/avatar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || "Failed to upload avatar");
      return;
    }
    setCommunityAvatarFile(null);
    await loadCommunityDetail(activeCommunity.slug, topicFilter);
    await loadCommunities();
  };

  const uploadCommunityBanner = async () => {
    if (!activeCommunity?.id || !communityBannerFile) return;
    const formData = new FormData();
    formData.append("banner", communityBannerFile);
    const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/banner`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || "Failed to upload banner");
      return;
    }
    setCommunityBannerFile(null);
    await loadCommunityDetail(activeCommunity.slug, topicFilter);
    await loadCommunities();
  };

  const moderateRequest = async (requestId, action) => {
    if (!activeCommunity?.id) return;
    try {
      const res = await fetch(
        `${API}/api/vine/communities/${activeCommunity.id}/requests/${requestId}/${action}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || `Failed to ${action} request`);
        return;
      }
      await loadRequests();
      await loadCommunityDetail(activeCommunity.slug);
      await loadCommunities();
    } catch {
      alert(`Failed to ${action} request`);
    }
  };

  const submitCommunityPost = async () => {
    if (!postText.trim() || !activeCommunity?.id) return;
    try {
      const formData = new FormData();
      formData.append("content", postText.trim());
      formData.append("community_id", String(activeCommunity.id));

      const res = await fetch(`${API}/api/vine/posts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to post");
        return;
      }
      setPostText("");
      setPosts((prev) => [data, ...prev]);
    } catch {
      alert("Failed to post");
    }
  };

  const scheduleCommunityPost = async () => {
    if (!postText.trim() || !scheduledAt || !activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/scheduled-posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content: postText.trim(),
          run_at: scheduledAt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to schedule post");
        return;
      }
      setPostText("");
      setScheduledAt("");
      loadScheduledPosts();
    } catch {
      alert("Failed to schedule post");
    }
  };

  const addRule = async () => {
    if (!newRule.trim() || !activeCommunity?.id) return;
    const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/rules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ rule_text: newRule.trim(), sort_order: rules.length }),
    });
    if (!res.ok) return;
    setNewRule("");
    loadCommunityDetail(activeCommunity.slug, topicFilter);
  };

  const removeRule = async (ruleId) => {
    if (!activeCommunity?.id) return;
    const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/rules/${ruleId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) loadCommunityDetail(activeCommunity.slug, topicFilter);
  };

  const addQuestion = async () => {
    if (!newQuestion.trim() || !activeCommunity?.id) return;
    const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/questions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ question_text: newQuestion.trim(), sort_order: questions.length }),
    });
    if (!res.ok) return;
    setNewQuestion("");
    loadCommunityDetail(activeCommunity.slug, topicFilter);
  };

  const removeQuestion = async (questionId) => {
    if (!activeCommunity?.id) return;
    const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/questions/${questionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) loadCommunityDetail(activeCommunity.slug, topicFilter);
  };

  const updateMemberRole = async (memberId, role) => {
    if (!activeCommunity?.id) return;
    const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/members/${memberId}/role`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ role }),
    });
    if (res.ok) loadCommunityDetail(activeCommunity.slug, topicFilter);
  };

  const createEvent = async () => {
    if (!activeCommunity?.id || !eventTitle.trim() || !eventStartsAt) return;
    const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: eventTitle.trim(),
        starts_at: eventStartsAt,
        location: eventLocation.trim(),
        description: eventDescription.trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || "Failed to create event");
      return;
    }
    setEventTitle("");
    setEventStartsAt("");
    setEventLocation("");
    setEventDescription("");
    loadCommunityDetail(activeCommunity.slug, topicFilter);
  };

  const reportToMods = async (postId) => {
    if (!activeCommunity?.id) return;
    const reason = window.prompt("Report reason");
    if (!reason || !reason.trim()) return;
    const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/reports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ post_id: postId, reason: reason.trim() }),
    });
    if (res.ok) alert("Reported to group mods");
  };

  const updateReportStatus = async (reportId, status) => {
    if (!activeCommunity?.id) return;
    const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/reports/${reportId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });
    if (res.ok) loadReports();
  };

  const togglePin = async (post) => {
    if (!activeCommunity?.id) return;
    const isPinned = Number(post.is_community_pinned) === 1;
    const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/posts/${post.id}/pin`, {
      method: isPinned ? "DELETE" : "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) loadCommunityDetail(activeCommunity.slug, topicFilter);
  };

  return (
    <div className="vine-communities-page">
      <div className="communities-top">
        <button className="communities-back" onClick={() => navigate("/vine/feed")}>← Feed</button>
        <h2>Communities</h2>
      </div>

      <div className="communities-layout">
        <aside className="communities-sidebar">
          <div className="communities-create">
            <button
              className="communities-create-toggle"
              onClick={() => setShowCreateCommunity((prev) => !prev)}
            >
              {showCreateCommunity ? "Close Create Community" : "Create Community"}
            </button>
            {showCreateCommunity && (
              <div className="communities-create-panel">
                <h3>Create Community</h3>
                <input
                  placeholder="Community name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
                <textarea
                  placeholder="Description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={280}
                />
                <button onClick={createCommunity}>Create</button>
              </div>
            )}
          </div>

          <div className="community-list">
            {communities.map((c) => (
              <div key={c.id} className={`community-row ${slug === c.slug ? "active" : ""}`}>
                <button
                  className="community-link"
                  onClick={() => navigate(`/vine/communities/${c.slug}`)}
                >
                  <strong>{c.name}</strong>
                  <span>{c.member_count} members</span>
                </button>
                <button className="community-join" onClick={() => toggleJoin(c)}>
                  {Number(c.is_member) === 1
                    ? "Leave"
                    : String(c.join_request_status || "") === "pending"
                    ? "Requested"
                    : "Join"}
                </button>
              </div>
            ))}
          </div>
        </aside>

        <main className="communities-main">
          {!activeCommunity ? (
            <div className="community-empty">Pick a community to view posts</div>
          ) : (
            <>
              <div className="community-hero">
                <div
                  className="community-banner"
                  style={
                    activeCommunity.banner_url
                      ? { backgroundImage: `url(${activeCommunity.banner_url})` }
                      : undefined
                  }
                />
                <div className="community-identity">
                  <div className="community-avatar">
                    {activeCommunity.avatar_url ? (
                      <img src={activeCommunity.avatar_url} alt={activeCommunity.name} />
                    ) : (
                      (activeCommunity.name || "?").trim().charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="community-title-wrap">
                    <h3>{activeCommunity.name}</h3>
                    <div className="community-meta-line">
                      <span>{activeCommunity.member_count || 0} members</span>
                      <span>•</span>
                      <span>{Number(activeCommunity.is_private) === 1 ? "Private" : "Public"}</span>
                    </div>
                  </div>
                  <button
                    className="community-join hero-join"
                    onClick={() =>
                      toggleJoin({
                        id: activeCommunity.id,
                        slug: activeCommunity.slug,
                        is_member: activeCommunity.is_member,
                        join_request_status: activeCommunity.join_request_status,
                      })
                    }
                  >
                    {Number(activeCommunity.is_member) === 1
                      ? "Joined"
                      : String(activeCommunity.join_request_status || "") === "pending"
                      ? "Requested"
                      : "Join"}
                  </button>
                </div>
              </div>

              <div className="community-tabs">
                <button className={activeTab === "discussion" ? "active" : ""} onClick={() => setActiveTab("discussion")}>Discussion</button>
                <button className={activeTab === "about" ? "active" : ""} onClick={() => setActiveTab("about")}>About</button>
                <button className={activeTab === "members" ? "active" : ""} onClick={() => setActiveTab("members")}>Members</button>
                <button className={activeTab === "events" ? "active" : ""} onClick={() => setActiveTab("events")}>Events</button>
                <button className={activeTab === "media" ? "active" : ""} onClick={() => setActiveTab("media")}>Media</button>
                <button className={activeTab === "reputation" ? "active" : ""} onClick={() => setActiveTab("reputation")}>Reputation</button>
                {["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase()) && (
                  <button className={activeTab === "reports" ? "active" : ""} onClick={() => setActiveTab("reports")}>Reports</button>
                )}
                {["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase()) && (
                  <button className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>Settings</button>
                )}
              </div>

              <div className="community-body-grid">
                {activeTab === "discussion" && (
                  <>
                    <aside className="community-info-card">
                      <h4>About</h4>
                      <p>{activeCommunity.description || "No description yet."}</p>
                      <div className="community-info-line">
                        Created: {new Date(activeCommunity.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    </aside>
                    <section className="community-discussion">
                      <div className="discussion-top">
                        <h4>Discussion</h4>
                        <div className="discussion-hint">
                          Topic:
                          <select
                            value={topicFilter}
                            onChange={(e) => setTopicFilter(e.target.value)}
                            className="topic-filter"
                          >
                            <option value="">All</option>
                            {[...new Set(posts.map((p) => p.topic_tag).filter(Boolean))].map((tag) => (
                              <option key={tag} value={tag}>
                                #{tag}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {Number(activeCommunity.is_member) === 1 &&
                      (String(activeCommunity.post_permission || "all") !== "mods_only" ||
                        ["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase())) ? (
                        <div className="community-create-box">
                          <textarea
                            value={postText}
                            onChange={(e) => setPostText(e.target.value)}
                            placeholder={`Share something in ${activeCommunity.name}`}
                            maxLength={2000}
                          />
                          <div className="community-create-actions">
                            <span>{postText.length}/2000</span>
                            <div className="schedule-controls">
                              <input
                                type="datetime-local"
                                value={scheduledAt}
                                onChange={(e) => setScheduledAt(e.target.value)}
                              />
                              <button onClick={scheduleCommunityPost}>Schedule</button>
                              <button onClick={submitCommunityPost}>Post</button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="community-join-note">
                          {Number(activeCommunity.is_member) !== 1
                            ? "Join this group to post in discussion."
                            : "Announcements mode is on. Only owner/moderators can post."}
                        </div>
                      )}
                      <div className="community-posts">
                        {posts.length === 0 ? (
                          <div className="community-empty">No posts in this community yet.</div>
                        ) : (
                          posts.map((post) => (
                            <div key={post.feed_id || post.id} className="community-post-wrap">
                              <div className="community-post-tools">
                                {["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase()) && (
                                  <button onClick={() => togglePin(post)}>
                                    {Number(post.is_community_pinned) === 1 ? "Unpin" : "Pin"}
                                  </button>
                                )}
                                {post.topic_tag && <span className="topic-chip">#{post.topic_tag}</span>}
                                <button onClick={() => reportToMods(post.id)}>Report to Mods</button>
                              </div>
                              <VinePostCard
                                post={post}
                                communityInteractionLocked={Number(activeCommunity.is_member) !== 1}
                                onDeletePost={(deletedId) =>
                                  setPosts((prev) => prev.filter((p) => p.id !== deletedId))
                                }
                              />
                            </div>
                          ))
                        )}
                      </div>
                    </section>
                  </>
                )}
                {activeTab === "about" && (
                  <section className="community-about-panel">
                    <h4>About {activeCommunity.name}</h4>
                    <p>{activeCommunity.description || "No description yet."}</p>
                    <div className="community-info-line">Members: {activeCommunity.member_count || 0}</div>
                    <div className="community-info-line">Visibility: {Number(activeCommunity.is_private) === 1 ? "Private" : "Public"}</div>
                    <div className="community-info-line">Join policy: {String(activeCommunity.join_policy || "open")}</div>
                    <div className="community-info-line">Posting: {String(activeCommunity.post_permission || "all") === "mods_only" ? "Admins/Mods only" : "All members"}</div>
                    {rules.length > 0 && (
                      <div className="rules-list">
                        <h5>Rules</h5>
                        {rules.map((r) => (
                          <div key={r.id} className="rule-item">• {r.rule_text}</div>
                        ))}
                      </div>
                    )}
                  </section>
                )}
                {activeTab === "members" && (
                  <section className="community-members-panel">
                    <h4>Members</h4>
                    <div className="community-members-list">
                      {members.map((m) => (
                        <button key={m.id} className="member-row" onClick={() => navigate(`/vine/profile/${m.username}`)}>
                          <img
                            src={m.avatar_url ? (m.avatar_url.startsWith("http") ? m.avatar_url : `${API}${m.avatar_url}`) : DEFAULT_AVATAR}
                            alt={m.username}
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_AVATAR;
                            }}
                          />
                          <div>
                            <div className="member-name">{m.display_name || m.username}</div>
                            <div className="member-meta">@{m.username} • {m.role}</div>
                          </div>
                          {String(activeCommunity.viewer_role || "").toLowerCase() === "owner" && Number(m.id) !== Number(activeCommunity.creator_id) && (
                            <select
                              className="member-role-select"
                              value={m.role}
                              onChange={(e) => updateMemberRole(m.id, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <option value="member">member</option>
                              <option value="moderator">moderator</option>
                            </select>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {activeTab === "events" && (
                  <section className="community-settings-panel">
                    <h4>Events</h4>
                    {["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase()) && (
                      <div className="event-create-grid">
                        <input placeholder="Event title" value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} />
                        <input type="datetime-local" value={eventStartsAt} onChange={(e) => setEventStartsAt(e.target.value)} />
                        <input placeholder="Location (optional)" value={eventLocation} onChange={(e) => setEventLocation(e.target.value)} />
                        <textarea placeholder="Event description (optional)" value={eventDescription} onChange={(e) => setEventDescription(e.target.value)} />
                        <button onClick={createEvent}>Create Event</button>
                      </div>
                    )}
                    <div className="events-list">
                      {events.length === 0 ? (
                        <div className="community-empty">No events yet.</div>
                      ) : (
                        events.map((ev) => (
                          <div key={ev.id} className="event-row">
                            <div className="member-name">{ev.title}</div>
                            <div className="member-meta">{new Date(ev.starts_at).toLocaleString()}</div>
                            {ev.location && <div className="member-meta">{ev.location}</div>}
                            {ev.description && <div className="member-meta">{ev.description}</div>}
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                )}
                {activeTab === "media" && (
                  <section className="community-members-panel">
                    <h4>Media</h4>
                    <div className="media-grid">
                      {mediaPosts.length === 0 ? (
                        <div className="community-empty">No media yet.</div>
                      ) : (
                        mediaPosts.flatMap((p) => {
                          let urls = [];
                          try {
                            const parsed = JSON.parse(p.image_url || "[]");
                            urls = Array.isArray(parsed) ? parsed : [p.image_url];
                          } catch {
                            urls = [p.image_url];
                          }
                          return urls.filter(Boolean).map((url, i) => (
                            <button
                              key={`${p.id}-${i}`}
                              className="media-item"
                              onClick={() => navigate(`/vine/feed?post=${p.id}`)}
                            >
                              {String(url).match(/\.(mp4|mov|webm)$/i) ? (
                                <video src={url} muted />
                              ) : (
                                <img src={url} alt="" />
                              )}
                            </button>
                          ));
                        })
                      )}
                    </div>
                  </section>
                )}
                {activeTab === "reputation" && (
                  <section className="community-members-panel">
                    <h4>Top Contributors</h4>
                    <div className="community-members-list">
                      {reputation.map((r) => (
                        <button key={r.id} className="member-row" onClick={() => navigate(`/vine/profile/${r.username}`)}>
                          <img
                            src={r.avatar_url ? (r.avatar_url.startsWith("http") ? r.avatar_url : `${API}${r.avatar_url}`) : DEFAULT_AVATAR}
                            alt={r.username}
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_AVATAR;
                            }}
                          />
                          <div>
                            <div className="member-name">{r.display_name || r.username}</div>
                            <div className="member-meta">Posts {r.posts_count} • Comments {r.comments_count} • Likes {r.likes_received}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {activeTab === "reports" && ["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase()) && (
                  <section className="community-settings-panel">
                    <h4>Mod Reports Queue</h4>
                    {reports.length === 0 ? (
                      <div className="community-empty">No reports.</div>
                    ) : (
                      reports.map((r) => (
                        <div key={r.id} className="request-row">
                          <div>
                            <div className="member-name">Report #{r.id} • {r.reason}</div>
                            <div className="member-meta">By {r.reporter_display_name || r.reporter_username} • {new Date(r.created_at).toLocaleString()} • {r.status}</div>
                          </div>
                          <div className="request-actions">
                            <button onClick={() => updateReportStatus(r.id, "resolved")}>Resolve</button>
                            <button onClick={() => updateReportStatus(r.id, "dismissed")}>Dismiss</button>
                          </div>
                        </div>
                      ))
                    )}
                  </section>
                )}
                {activeTab === "settings" && ["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase()) && (
                  <section className="community-settings-panel">
                    <h4>Group Settings</h4>
                    <label className="settings-row">
                      <span>How members join this community</span>
                      <select value={joinPolicy} onChange={(e) => setJoinPolicy(e.target.value)}>
                        <option value="open">Open (anyone can join)</option>
                        <option value="approval">Approval required</option>
                        <option value="closed">Closed (no new members)</option>
                      </select>
                    </label>
                    <label className="settings-row">
                      <span>Who can post</span>
                      <select value={postPermission} onChange={(e) => setPostPermission(e.target.value)}>
                        <option value="all">All members</option>
                        <option value="mods_only">Only owner/moderators</option>
                      </select>
                    </label>
                    <label className="settings-row">
                      <span>Auto welcome for new members</span>
                      <select value={autoWelcomeEnabled ? "1" : "0"} onChange={(e) => setAutoWelcomeEnabled(e.target.value === "1")}>
                        <option value="1">Enabled</option>
                        <option value="0">Disabled</option>
                      </select>
                    </label>
                    <label className="settings-row">
                      <span>Welcome message</span>
                      <input
                        value={welcomeMessage}
                        onChange={(e) => setWelcomeMessage(e.target.value)}
                        maxLength={280}
                        placeholder={`Welcome to ${activeCommunity.name}!`}
                      />
                    </label>
                    <button className="save-settings-btn" onClick={saveSettings}>Save Settings</button>
                    <div className="community-upload-grid">
                      <label className="settings-row">
                        <span>Community avatar</span>
                        <input
                          type="file"
                          accept="image/*,.heic,.heif"
                          onChange={(e) => setCommunityAvatarFile(e.target.files?.[0] || null)}
                        />
                        <button type="button" onClick={uploadCommunityAvatar} disabled={!communityAvatarFile}>
                          Upload Avatar
                        </button>
                      </label>
                      <label className="settings-row">
                        <span>Community banner</span>
                        <input
                          type="file"
                          accept="image/*,.heic,.heif"
                          onChange={(e) => setCommunityBannerFile(e.target.files?.[0] || null)}
                        />
                        <button type="button" onClick={uploadCommunityBanner} disabled={!communityBannerFile}>
                          Upload Banner
                        </button>
                      </label>
                    </div>

                    {joinPolicy === "approval" && (
                      <div className="request-panel">
                        <h5>Pending Join Requests</h5>
                        {pendingRequests.length === 0 ? (
                          <div className="community-empty">No pending requests.</div>
                        ) : (
                          pendingRequests.map((r) => (
                            <div key={r.id} className="request-row">
                              <div>
                                <div className="member-name">{r.display_name || r.username}</div>
                                <div className="member-meta">@{r.username}</div>
                                {r.answers_json && (
                                  <div className="request-answers">
                                    {parseAnswers(r.answers_json).map((a, i) => (
                                      <div key={i}>• {String(a)}</div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="request-actions">
                                <button onClick={() => moderateRequest(r.id, "approve")}>Approve</button>
                                <button className="danger" onClick={() => moderateRequest(r.id, "reject")}>Reject</button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    <div className="rules-editor">
                      <h5>Rules</h5>
                      {rules.map((r) => (
                        <div key={r.id} className="rule-edit-row">
                          <span>{r.rule_text}</span>
                          <button onClick={() => removeRule(r.id)}>Delete</button>
                        </div>
                      ))}
                      <div className="inline-add-row">
                        <input value={newRule} onChange={(e) => setNewRule(e.target.value)} placeholder="Add a rule" maxLength={240} />
                        <button onClick={addRule}>Add</button>
                      </div>
                    </div>

                    <div className="rules-editor">
                      <h5>Join Questions</h5>
                      {questions.map((q) => (
                        <div key={q.id} className="rule-edit-row">
                          <span>{q.question_text}</span>
                          <button onClick={() => removeQuestion(q.id)}>Delete</button>
                        </div>
                      ))}
                      <div className="inline-add-row">
                        <input value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder="Add a join question" maxLength={240} />
                        <button onClick={addQuestion}>Add</button>
                      </div>
                    </div>

                    <div className="rules-editor">
                      <h5>Scheduled Posts</h5>
                      {scheduledPosts.length === 0 ? (
                        <div className="community-empty">No scheduled posts.</div>
                      ) : (
                        scheduledPosts.map((s) => (
                          <div key={s.id} className="rule-edit-row">
                            <span>{s.content}</span>
                            <small>{new Date(s.run_at).toLocaleString()}</small>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
