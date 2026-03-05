import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
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
  const [searchParams] = useSearchParams();
  const DEFAULT_AVATAR = "/default-avatar.png";
  const [communities, setCommunities] = useState([]);
  const [activeCommunity, setActiveCommunity] = useState(null);
  const [posts, setPosts] = useState([]);
  const [members, setMembers] = useState([]);
  const [activeTab, setActiveTab] = useState("discussion");
  const [joinPolicy, setJoinPolicy] = useState("open");
  const [autoWelcomeEnabled, setAutoWelcomeEnabled] = useState(true);
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [pendingRequests, setPendingRequests] = useState([]);
  const [postText, setPostText] = useState("");
  const [communityFiles, setCommunityFiles] = useState([]);
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
  const [sessions, setSessions] = useState([]);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionStartsAt, setSessionStartsAt] = useState("");
  const [sessionEndsAt, setSessionEndsAt] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [attendanceDrafts, setAttendanceDrafts] = useState({});
  const [attendanceSummary, setAttendanceSummary] = useState({ lessons_attended: 0 });
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [mediaPosts, setMediaPosts] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [assignmentInstructions, setAssignmentInstructions] = useState("");
  const [assignmentDueAt, setAssignmentDueAt] = useState("");
  const [assignmentPoints, setAssignmentPoints] = useState(100);
  const [assignmentRubric, setAssignmentRubric] = useState("");
  const [assignmentFile, setAssignmentFile] = useState(null);
  const [submissionDrafts, setSubmissionDrafts] = useState({});
  const [savedDraftsMap, setSavedDraftsMap] = useState({});
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(null);
  const [assignmentSubmissions, setAssignmentSubmissions] = useState([]);
  const [gradingDrafts, setGradingDrafts] = useState({});
  const [badgesStreaks, setBadgesStreaks] = useState([]);
  const [reputation, setReputation] = useState([]);
  const [reports, setReports] = useState([]);
  const [topicFilter, setTopicFilter] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [communityAvatarFile, setCommunityAvatarFile] = useState(null);
  const [communityBannerFile, setCommunityBannerFile] = useState(null);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const communityPostRef = useRef(null);
  const assignmentFileInputRef = useRef(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeCommunity?.name) {
      document.title = `Vine — ${activeCommunity.name}`;
      return;
    }
    document.title = "Vine — Communities";
  }, [activeCommunity?.name]);

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

      const [pRes, mRes, rulesRes, questionsRes, eventsRes, mediaRes, assignmentsRes] = await Promise.all([
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
        fetch(`${API}/api/vine/communities/${encodeURIComponent(communitySlug)}/assignments`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const pData = await pRes.json().catch(() => []);
      const mData = await mRes.json().catch(() => []);
      const rulesData = await rulesRes.json().catch(() => []);
      const qData = await questionsRes.json().catch(() => []);
      const eventsData = await eventsRes.json().catch(() => []);
      const mediaData = await mediaRes.json().catch(() => []);
      const assignmentsData = await assignmentsRes.json().catch(() => []);
      setActiveCommunity(cData);
      setPosts(Array.isArray(pData) ? pData : []);
      setMembers(Array.isArray(mData) ? mData : []);
      setRules(Array.isArray(rulesData) ? rulesData : []);
      setQuestions(Array.isArray(qData) ? qData : []);
      setEvents(Array.isArray(eventsData) ? eventsData : []);
      setMediaPosts(Array.isArray(mediaData) ? mediaData : []);
      const safeAssignments = Array.isArray(assignmentsData) ? assignmentsData : [];
      setAssignments(safeAssignments);
      const persisted = {};
      for (const a of safeAssignments) {
        if (a.viewer_draft_content && !a.viewer_submission_content) {
          persisted[a.id] = a.viewer_draft_content;
        }
      }
      setSavedDraftsMap(persisted);
      setJoinPolicy(cData?.join_policy || "open");
      setAutoWelcomeEnabled(Number(cData?.auto_welcome_enabled ?? 1) === 1);
      setWelcomeMessage(cData?.welcome_message || "");
      setSessions([]);
      setSelectedSessionId(null);
      setAttendanceRows([]);
      setAttendanceDrafts({});
      setAttendanceSummary({ lessons_attended: 0 });
      setAttendanceRecords([]);
    } catch {
      setActiveCommunity(null);
      setPosts([]);
      setMembers([]);
      setRules([]);
      setQuestions([]);
      setEvents([]);
      setSessions([]);
      setSelectedSessionId(null);
      setAttendanceRows([]);
      setAttendanceDrafts({});
      setAttendanceSummary({ lessons_attended: 0 });
      setAttendanceRecords([]);
      setMediaPosts([]);
      setAssignments([]);
      setSavedDraftsMap({});
    }
  };

  useEffect(() => {
    loadCommunities();
  }, []);

  useEffect(() => {
    loadCommunityDetail(slug, topicFilter);
  }, [slug, topicFilter]);

  useEffect(() => {
    const tab = String(searchParams.get("tab") || "").toLowerCase();
    const allowed = new Set([
      "discussion",
      "about",
      "members",
      "events",
      "assignments",
      "media",
      "reputation",
      "reports",
      "settings",
    ]);
    if (allowed.has(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

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

  const loadBadgesStreaks = async () => {
    if (!activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/badges-streaks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setBadgesStreaks(Array.isArray(data) ? data : []);
    } catch {
      setBadgesStreaks([]);
    }
  };

  const loadAssignmentSubmissions = async (assignmentId) => {
    if (!activeCommunity?.id || !assignmentId) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/assignments/${assignmentId}/submissions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const rows = Array.isArray(data) ? data : [];
      setAssignmentSubmissions(rows);
      const initialDrafts = {};
      rows.forEach((row) => {
        const normalized = String(row.status || "").toLowerCase();
        const safeStatus = ["graded", "needs_revision", "missing"].includes(normalized)
          ? normalized
          : "graded";
        initialDrafts[row.id] = {
          score: row.score ?? "",
          feedback: row.feedback || "",
          status: safeStatus,
        };
      });
      setGradingDrafts(initialDrafts);
    } catch {
      setAssignmentSubmissions([]);
      setGradingDrafts({});
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
    if (activeTab === "assignments" && activeCommunity?.id) loadBadgesStreaks();
    if (activeTab === "attendance" && activeCommunity?.id) {
      const role = String(activeCommunity.viewer_role || "").toLowerCase();
      if (["owner", "moderator"].includes(role)) {
        loadSessions();
      } else {
        loadAttendanceRecords();
      }
    }
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
          post_permission: "mods_only",
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
              post_permission: "mods_only",
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

  const applyCommunityFormat = (leftToken, rightToken = leftToken) => {
    const el = communityPostRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const before = postText.slice(0, start);
    const selected = postText.slice(start, end);
    const after = postText.slice(end);
    const next = `${before}${leftToken}${selected}${rightToken}${after}`;
    setPostText(next);
    requestAnimationFrame(() => {
      el.focus();
      if (selected.length > 0) {
        el.setSelectionRange(start + leftToken.length, end + leftToken.length);
      } else {
        const cursor = start + leftToken.length;
        el.setSelectionRange(cursor, cursor);
      }
    });
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
    if ((!postText.trim() && communityFiles.length === 0) || !activeCommunity?.id) return;
    try {
      const formData = new FormData();
      if (postText.trim()) formData.append("content", postText.trim());
      formData.append("community_id", String(activeCommunity.id));
      communityFiles.forEach((file) => formData.append("images", file));

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
      setCommunityFiles([]);
      setPosts((prev) => [data, ...prev]);
    } catch {
      alert("Failed to post");
    }
  };

  const createAssignment = async () => {
    if (!activeCommunity?.id || !assignmentTitle.trim()) return;
    try {
      const formData = new FormData();
      formData.append("title", assignmentTitle.trim());
      formData.append("instructions", assignmentInstructions.trim());
      formData.append("due_at", assignmentDueAt || "");
      formData.append("points", String(Number(assignmentPoints || 100)));
      formData.append("rubric", assignmentRubric.trim());
      if (assignmentFile) formData.append("assignment_file", assignmentFile);

      setAssignmentFile(null);
      if (assignmentFileInputRef.current) {
        assignmentFileInputRef.current.value = "";
      }

      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/assignments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to create assignment");
        return;
      }
      setAssignmentTitle("");
      setAssignmentInstructions("");
      setAssignmentDueAt("");
      setAssignmentPoints(100);
      setAssignmentRubric("");
      setAssignmentFile(null);
      await loadCommunityDetail(activeCommunity.slug, topicFilter);
      alert("Assignment created");
    } catch {
      alert("Failed to create assignment");
    }
  };

  const submitAssignment = async (assignmentId) => {
    if (!activeCommunity?.id || !assignmentId) return;
    const text = String(submissionDrafts[assignmentId] || savedDraftsMap[assignmentId] || "").trim();
    if (!text) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/assignments/${assignmentId}/submissions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to submit assignment");
        return;
      }
      setSubmissionDrafts((prev) => ({ ...prev, [assignmentId]: "" }));
      setSavedDraftsMap((prev) => ({ ...prev, [assignmentId]: "" }));
      await loadCommunityDetail(activeCommunity.slug, topicFilter);
      alert("Assignment submitted");
    } catch {
      alert("Failed to submit assignment");
    }
  };

  const saveAssignmentDraft = async (assignmentId) => {
    if (!activeCommunity?.id || !assignmentId) return;
    const text = String(submissionDrafts[assignmentId] || "").trim();
    if (!text) {
      alert("Write your answer first.");
      return;
    }
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/assignments/${assignmentId}/draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to save draft");
        return;
      }
      setSavedDraftsMap((prev) => ({ ...prev, [assignmentId]: text }));
      alert("Draft saved");
    } catch {
      alert("Failed to save draft");
    }
  };

  const deleteAssignment = async (assignmentId) => {
    if (!activeCommunity?.id || !assignmentId) return;
    const ok = window.confirm("Delete this assignment and all submissions?");
    if (!ok) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/assignments/${assignmentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to delete assignment");
        return;
      }
      if (Number(selectedAssignmentId) === Number(assignmentId)) {
        setSelectedAssignmentId(null);
        setAssignmentSubmissions([]);
        setGradingDrafts({});
      }
      await loadCommunityDetail(activeCommunity.slug, topicFilter);
      alert("Assignment deleted");
    } catch {
      alert("Failed to delete assignment");
    }
  };

  const gradeSubmission = async (submissionId) => {
    if (!activeCommunity?.id || !submissionId) return;
    const draft = gradingDrafts[submissionId] || {};
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/submissions/${submissionId}/grade`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          score: draft.score,
          feedback: draft.feedback,
          status: draft.status || "graded",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to save grade");
        return;
      }
      alert("Grade saved");
      setAssignmentSubmissions((prev) =>
        prev.map((s) =>
          s.id === submissionId
            ? {
                ...s,
                score: draft.score === "" || draft.score === null || draft.score === undefined ? null : Number(draft.score),
                feedback: draft.feedback || "",
                status: draft.status || "graded",
                graded_at: new Date().toISOString(),
              }
            : s
        )
      );
      if (selectedAssignmentId) {
        await loadAssignmentSubmissions(selectedAssignmentId);
      }
      await loadCommunityDetail(activeCommunity.slug, topicFilter);
    } catch {
      alert("Failed to save grade");
    }
  };

  const exportGradebookCsv = async () => {
    if (!activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/gradebook?format=csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        alert("Failed to export CSV");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `community-${activeCommunity.id}-gradebook.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export CSV");
    }
  };

  const toggleAssignmentReview = async (assignmentId) => {
    if (!assignmentId) return;
    if (Number(selectedAssignmentId) === Number(assignmentId)) {
      setSelectedAssignmentId(null);
      setAssignmentSubmissions([]);
      setGradingDrafts({});
      return;
    }
    setSelectedAssignmentId(assignmentId);
    await loadAssignmentSubmissions(assignmentId);
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

  const kickMember = async (memberId, username) => {
    if (!activeCommunity?.id || !memberId) return;
    const ok = window.confirm(`Remove @${username} from this community?`);
    if (!ok) return;
    const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/members/${memberId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || "Failed to remove member");
      return;
    }
    loadCommunityDetail(activeCommunity.slug, topicFilter);
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

  const loadSessions = async () => {
    if (!activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => []);
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      setSessions([]);
    }
  };

  const createSession = async () => {
    if (!activeCommunity?.id || !sessionTitle.trim() || !sessionStartsAt) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: sessionTitle.trim(),
          starts_at: sessionStartsAt,
          ends_at: sessionEndsAt || null,
          notes: sessionNotes.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to create class");
        return;
      }
      setSessionTitle("");
      setSessionStartsAt("");
      setSessionEndsAt("");
      setSessionNotes("");
      await loadSessions();
      alert("Class session created");
    } catch {
      alert("Failed to create class");
    }
  };

  const loadAttendance = async (sessionId) => {
    if (!activeCommunity?.id || !sessionId) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/sessions/${sessionId}/attendance`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => []);
      const rows = Array.isArray(data) ? data : [];
      setAttendanceRows(rows);
      const nextDrafts = {};
      for (const r of rows) {
        nextDrafts[r.user_id] = r.status || "absent";
      }
      setAttendanceDrafts(nextDrafts);
    } catch {
      setAttendanceRows([]);
      setAttendanceDrafts({});
    }
  };

  const loadAttendanceSummary = async () => {
    if (!activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/attendance/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({ lessons_attended: 0 }));
      setAttendanceSummary({ lessons_attended: Number(data?.lessons_attended || 0) });
    } catch {
      setAttendanceSummary({ lessons_attended: 0 });
    }
  };

  const loadAttendanceRecords = async () => {
    if (!activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/attendance/my-records`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({ lessons_attended: 0, lessons_missed: 0, rows: [] }));
      setAttendanceSummary({
        lessons_attended: Number(data?.lessons_attended || 0),
        lessons_missed: Number(data?.lessons_missed || 0),
      });
      setAttendanceRecords(Array.isArray(data?.rows) ? data.rows : []);
    } catch {
      setAttendanceRecords([]);
      setAttendanceSummary({ lessons_attended: 0, lessons_missed: 0 });
    }
  };

  const saveAttendance = async () => {
    if (!activeCommunity?.id || !selectedSessionId) return;
    try {
      const entries = Object.entries(attendanceDrafts).map(([user_id, status]) => ({
        user_id: Number(user_id),
        status,
      }));
      const res = await fetch(
        `${API}/api/vine/communities/${activeCommunity.id}/sessions/${selectedSessionId}/attendance/bulk`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ entries }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to save attendance");
        return;
      }
      await loadAttendance(selectedSessionId);
      await loadSessions();
      alert("Attendance saved");
    } catch {
      alert("Failed to save attendance");
    }
  };

  const markAllPresent = () => {
    if (!attendanceRows.length) return;
    const next = {};
    for (const row of attendanceRows) next[row.user_id] = "present";
    setAttendanceDrafts(next);
  };

  const exportAttendanceCsv = () => {
    if (!selectedSessionId) return;
    const session = sessions.find((s) => Number(s.id) === Number(selectedSessionId));
    const header = ["display_name", "username", "role", "status"];
    const rows = attendanceRows.map((row) => [
      String(row.display_name || row.username || ""),
      String(row.username || ""),
      String(row.community_role || "member"),
      String(attendanceDrafts[row.user_id] || row.status || "absent"),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeTitle = String(session?.title || "session").replace(/[^a-z0-9-_]+/gi, "_");
    a.download = `attendance_${safeTitle}_${selectedSessionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAttendancePdf = () => {
    if (!selectedSessionId) return;
    const session = sessions.find((s) => Number(s.id) === Number(selectedSessionId));
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(16);
    doc.text("ST. PHILLIPS EQUATORIAL SECONDARY SCHOOL", 40, 42);
    doc.setFontSize(11);
    doc.text(`${activeCommunity?.name || "Community"} - Register`, 40, 62);
    doc.text(`Session: ${session?.title || "Untitled"}`, 40, 78);
    doc.text(`Date: ${session?.starts_at ? new Date(session.starts_at).toLocaleString() : ""}`, 40, 94);
    const body = attendanceRows.map((row, idx) => [
      idx + 1,
      row.display_name || row.username || "",
      `@${row.username || ""}`,
      attendanceDrafts[row.user_id] || row.status || "absent",
      "",
    ]);
    autoTable(doc, {
      startY: 108,
      head: [["No", "Name", "Username", "Status", "Signature"]],
      body,
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [20, 83, 45] },
    });
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
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

  const isCommunityMod = ["owner", "moderator"].includes(String(activeCommunity?.viewer_role || "").toLowerCase());
  const isAttendanceManager = ["owner", "moderator"].includes(String(activeCommunity?.viewer_role || "").toLowerCase());
  const isAssignmentPastDue = (assignment) => {
    if (!assignment?.due_at) return false;
    const due = new Date(assignment.due_at);
    if (Number.isNaN(due.getTime())) return false;
    return due.getTime() < nowMs;
  };

  const formatAssignmentCreatedAt = (value) => {
    if (!value) return "Unknown";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "Unknown";
    return dt.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatAssignmentCountdown = (dueAt) => {
    if (!dueAt) return "No deadline";
    const due = new Date(dueAt);
    if (Number.isNaN(due.getTime())) return "No deadline";
    const diff = due.getTime() - nowMs;
    if (diff <= 0) return "Deadline passed";
    const totalMinutes = Math.floor(diff / (60 * 1000));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
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
                  <div className="community-link-avatar">
                    {c.avatar_url ? (
                      <img
                        src={c.avatar_url.startsWith("http") ? c.avatar_url : `${API}${c.avatar_url}`}
                        alt={c.name}
                      />
                    ) : (
                      (c.name || "?").trim().charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="community-link-meta">
                    <strong>{c.name}</strong>
                    <span>{c.member_count} members</span>
                  </div>
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
                <button className={activeTab === "attendance" ? "active" : ""} onClick={() => setActiveTab("attendance")}>Attendance</button>
                <button className={activeTab === "assignments" ? "active" : ""} onClick={() => setActiveTab("assignments")}>Assignments</button>
                <button className={activeTab === "media" ? "active" : ""} onClick={() => setActiveTab("media")}>Media</button>
                <button className={activeTab === "reputation" ? "active" : ""} onClick={() => setActiveTab("reputation")}>Reputation</button>
                {["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase()) && (
                  <button className={activeTab === "reports" ? "active" : ""} onClick={() => setActiveTab("reports")}>Reports</button>
                )}
                {["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase()) && (
                  <button className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>Settings</button>
                )}
              </div>

              <div
                className={`community-body-grid ${
                  activeTab === "discussion" ? "discussion-only" : ""
                } ${activeTab === "assignments" ? "assignments-only" : ""} ${
                  activeTab === "attendance" ? "attendance-only" : ""
                }`}
              >
                {activeTab === "discussion" && (
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
                      ["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase()) ? (
                        <div className="community-create-box">
                          <div className="community-format-toolbar">
                            <button type="button" onClick={() => applyCommunityFormat("**")} title="Bold">B</button>
                            <button type="button" onClick={() => applyCommunityFormat("*")} title="Italic"><em>I</em></button>
                            <button type="button" onClick={() => applyCommunityFormat("__")} title="Underline"><u>U</u></button>
                            <button type="button" onClick={() => applyCommunityFormat("~~")} title="Strikethrough"><s>S</s></button>
                          </div>
                          <textarea
                            ref={communityPostRef}
                            value={postText}
                            onChange={(e) => setPostText(e.target.value)}
                            placeholder={`Share something in ${activeCommunity.name}`}
                            maxLength={2000}
                          />
                          <div className="community-create-actions">
                            <span>{postText.length}/2000</span>
                            <div className="schedule-controls">
                              <label className="community-file-picker">
                                Attach files
                                <input
                                  type="file"
                                  multiple
                                  accept="image/*,video/*,application/pdf,.pdf"
                                  onChange={(e) => setCommunityFiles(Array.from(e.target.files || []).slice(0, 10))}
                                />
                              </label>
                              <input
                                type="datetime-local"
                                value={scheduledAt}
                                onChange={(e) => setScheduledAt(e.target.value)}
                              />
                              <button onClick={scheduleCommunityPost}>Schedule</button>
                              <button onClick={submitCommunityPost}>Post</button>
                            </div>
                          </div>
                          {communityFiles.length > 0 && (
                            <div className="community-files-list">
                              {communityFiles.map((file, idx) => (
                                <div key={`${file.name}-${idx}`} className="community-file-chip">
                                  <span>{file.name}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCommunityFiles((prev) => prev.filter((_, i) => i !== idx))
                                    }
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="community-join-note">
                          {Number(activeCommunity.is_member) !== 1
                            ? "Join this group to post in discussion."
                            : "Only owner/moderators can post in Discussion. Members can still reply on community posts."}
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
                )}
                {activeTab === "about" && (
                  <section className="community-about-panel">
                    <h4>About {activeCommunity.name}</h4>
                    <p>{activeCommunity.description || "No description yet."}</p>
                    <div className="community-info-line">Members: {activeCommunity.member_count || 0}</div>
                    <div className="community-info-line">Visibility: {Number(activeCommunity.is_private) === 1 ? "Private" : "Public"}</div>
                    <div className="community-info-line">Join policy: {String(activeCommunity.join_policy || "open")}</div>
                    <div className="community-info-line">Posting: Admins/Mods only</div>
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
                        <div key={m.id} className="member-row" onClick={() => navigate(`/vine/profile/${m.username}`)}>
                          <img
                            src={m.avatar_url ? (m.avatar_url.startsWith("http") ? m.avatar_url : `${API}${m.avatar_url}`) : DEFAULT_AVATAR}
                            alt={m.username}
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_AVATAR;
                            }}
                          />
                          <div className="member-main">
                            <div className="member-name">{m.display_name || m.username}</div>
                            <div className="member-meta">@{m.username} • {m.role}</div>
                          </div>
                          <div className="member-actions" onClick={(e) => e.stopPropagation()}>
                            {String(activeCommunity.viewer_role || "").toLowerCase() === "owner" && Number(m.id) !== Number(activeCommunity.creator_id) && (
                              <select
                                className="member-role-select"
                                value={m.role}
                                onChange={(e) => updateMemberRole(m.id, e.target.value)}
                              >
                                <option value="member">member</option>
                                <option value="moderator">moderator</option>
                              </select>
                            )}
                            {["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase()) &&
                              String(m.role || "").toLowerCase() !== "owner" &&
                              !(
                                String(activeCommunity.viewer_role || "").toLowerCase() === "moderator" &&
                                String(m.role || "").toLowerCase() !== "member"
                              ) && (
                                <button
                                  type="button"
                                  className="member-kick-btn"
                                  onClick={() => kickMember(m.id, m.username)}
                                >
                                  Remove
                                </button>
                              )}
                          </div>
                        </div>
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
                {activeTab === "attendance" && (
                  <section className="community-settings-panel attendance-panel">
                    <div className="assignment-top-row attendance-top-row">
                      <h4>Class Register</h4>
                      {isAttendanceManager && (
                        <div className="attendance-actions">
                          <button onClick={saveAttendance} disabled={!selectedSessionId}>Save Register</button>
                          <button type="button" onClick={markAllPresent} disabled={!selectedSessionId || attendanceRows.length === 0}>Mark All Present</button>
                          <button type="button" onClick={exportAttendanceCsv} disabled={!selectedSessionId}>Export CSV</button>
                          <button type="button" onClick={exportAttendancePdf} disabled={!selectedSessionId}>Export PDF</button>
                        </div>
                      )}
                    </div>

                    {isAttendanceManager ? (
                      <>
                      <div className="attendance-create-grid">
                        <input
                          placeholder="Class title"
                          value={sessionTitle}
                          onChange={(e) => setSessionTitle(e.target.value)}
                          maxLength={180}
                        />
                        <input
                          type="datetime-local"
                          value={sessionStartsAt}
                          onChange={(e) => setSessionStartsAt(e.target.value)}
                        />
                        <input
                          type="datetime-local"
                          value={sessionEndsAt}
                          onChange={(e) => setSessionEndsAt(e.target.value)}
                        />
                        <input
                          placeholder="Notes (optional)"
                          value={sessionNotes}
                          onChange={(e) => setSessionNotes(e.target.value)}
                        />
                        <button onClick={createSession}>Create Class Session</button>
                      </div>

                    <div className="attendance-session-list">
                      {sessions.length === 0 ? (
                        <div className="community-empty">No class sessions yet.</div>
                      ) : (
                        sessions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className={`attendance-session-card ${Number(selectedSessionId) === Number(s.id) ? "active" : ""}`}
                            onClick={async () => {
                              setSelectedSessionId(s.id);
                              await loadAttendance(s.id);
                            }}
                          >
                            <div className="member-name">{s.title}</div>
                            <div className="member-meta">
                              {new Date(s.starts_at).toLocaleString()}
                              {s.ends_at ? ` → ${new Date(s.ends_at).toLocaleString()}` : ""}
                            </div>
                            <div className="member-meta">
                              Present {s.present_count || 0} • Absent {s.absent_count || 0} • Late {s.late_count || 0} • Excused {s.excused_count || 0}
                            </div>
                          </button>
                        ))
                      )}
                    </div>

                    {selectedSessionId && (
                      <div className="assignment-submissions attendance-mark-panel">
                        <div className="assignment-submissions-head">
                          <strong>Mark Attendance</strong>
                        </div>
                        {attendanceRows.length === 0 ? (
                          <div className="community-empty">No members found.</div>
                        ) : (
                          attendanceRows.map((row) => (
                            <div className="assignment-submission-item attendance-member-row" key={`att-${row.user_id}`}>
                              <div className="assignment-submission-head">
                                <img
                                  src={row.avatar_url ? (row.avatar_url.startsWith("http") ? row.avatar_url : `${API}${row.avatar_url}`) : DEFAULT_AVATAR}
                                  alt={row.username}
                                  onError={(e) => {
                                    e.currentTarget.src = DEFAULT_AVATAR;
                                  }}
                                />
                                <div>
                                  <div className="member-name">{row.display_name || row.username}</div>
                                  <div className="member-meta">@{row.username} • {row.community_role}</div>
                                </div>
                              </div>
                              <div className="assignment-grade-grid attendance-status-row">
                                <select
                                  className="attendance-status-select"
                                  value={attendanceDrafts[row.user_id] || "absent"}
                                  onChange={(e) =>
                                    setAttendanceDrafts((prev) => ({ ...prev, [row.user_id]: e.target.value }))
                                  }
                                  disabled={!isAttendanceManager}
                                >
                                  <option value="present">present</option>
                                  <option value="absent">absent</option>
                                  <option value="late">late</option>
                                  <option value="excused">excused</option>
                                </select>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                      </>
                    ) : (
                      <div className="attendance-member-view">
                        <div className="attendance-summary-grid">
                          <div className="attendance-summary-card">
                            <div className="attendance-summary-label">Lessons Attended</div>
                            <div className="attendance-summary-value">{attendanceSummary.lessons_attended || 0}</div>
                          </div>
                          <div className="attendance-summary-card missed">
                            <div className="attendance-summary-label">Lessons Missed</div>
                            <div className="attendance-summary-value">{attendanceSummary.lessons_missed || 0}</div>
                          </div>
                        </div>
                        <div className="attendance-history-list">
                          {attendanceRecords.length === 0 ? (
                            <div className="community-empty">No attendance records yet.</div>
                          ) : (
                            attendanceRecords.map((row) => (
                              <div key={`my-att-${row.session_id}`} className="attendance-history-row">
                                <div className="member-name">{row.title || "Lesson"}</div>
                                <div className="member-meta">{new Date(row.starts_at).toLocaleString()}</div>
                                <div className={`attendance-status-pill ${String(row.status || "").toLowerCase()}`}>
                                  {String(row.status || "absent")}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                )}
                {activeTab === "assignments" && (
                  <section className="community-settings-panel">
                    <div className="assignment-top-row">
                      <h4>Assignments</h4>
                      {isCommunityMod && (
                        <button onClick={exportGradebookCsv}>Export Gradebook CSV</button>
                      )}
                    </div>
                    {isCommunityMod && (
                      <div className="assignment-create-grid">
                        <input
                          placeholder="Assignment title"
                          value={assignmentTitle}
                          onChange={(e) => setAssignmentTitle(e.target.value)}
                          maxLength={160}
                        />
                        <textarea
                          placeholder="Instructions"
                          value={assignmentInstructions}
                          onChange={(e) => setAssignmentInstructions(e.target.value)}
                        />
                        <input
                          type="datetime-local"
                          value={assignmentDueAt}
                          onChange={(e) => setAssignmentDueAt(e.target.value)}
                        />
                        <input
                          type="number"
                          min={0.1}
                          step={0.1}
                          value={assignmentPoints}
                          onChange={(e) => setAssignmentPoints(e.target.value)}
                          placeholder="Points"
                        />
                        <textarea
                          placeholder="Rubric (optional)"
                          value={assignmentRubric}
                          onChange={(e) => setAssignmentRubric(e.target.value)}
                        />
                        <label className="assignment-file-picker">
                          <span>Attach PDF</span>
                          <input
                            ref={assignmentFileInputRef}
                            type="file"
                            accept=".pdf,application/pdf"
                            onChange={(e) => setAssignmentFile(e.target.files?.[0] || null)}
                          />
                        </label>
                        {assignmentFile && (
                          <div className="assignment-file-chip">
                            <span>{assignmentFile.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setAssignmentFile(null);
                                if (assignmentFileInputRef.current) {
                                  assignmentFileInputRef.current.value = "";
                                }
                              }}
                            >
                              ×
                            </button>
                          </div>
                        )}
                        <button onClick={createAssignment}>Create Assignment</button>
                      </div>
                    )}
                    <div className="assignments-list">
                      {assignments.length === 0 ? (
                        <div className="community-empty">No assignments yet.</div>
                      ) : (
                        assignments.map((a) => {
                          const draftValue = submissionDrafts[a.id] || "";
                          const persistedDraft = savedDraftsMap[a.id] || "";
                          const viewerStatus = a.viewer_submission_status || "";
                          const pastDue = isAssignmentPastDue(a);
                          const attempts = Number(a.viewer_submission_attempts || 0);
                          const submissionLocked = attempts >= 2;
                          const gradedLocked =
                            Boolean(a.viewer_submission_graded_at) ||
                            a.viewer_submission_score !== null && a.viewer_submission_score !== undefined ||
                            ["graded", "needs_revision", "missing"].includes(
                              String(viewerStatus || "").toLowerCase()
                            );
                          return (
                            <div key={a.id} className={`assignment-row ${isCommunityMod ? "mod-view" : ""}`}>
                              <div className="member-name">{a.title}</div>
                              <div className="member-meta">
                                Due: {a.due_at ? new Date(a.due_at).toLocaleString() : "No due date"} • Points: {a.points}
                              </div>
                              <div className="member-meta">
                                {formatAssignmentCountdown(a.due_at)} • Created: {formatAssignmentCreatedAt(a.created_at)}
                              </div>
                              {pastDue && (
                                <div className="assignment-due-warning">Submission window closed (past due date)</div>
                              )}
                              {a.instructions && <div className="assignment-body">{a.instructions}</div>}
                              {a.attachment_url && (
                                <div className="assignment-attachment">
                                  <a
                                    href={a.attachment_url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    📄 {a.attachment_name || "Assignment attachment"}
                                  </a>
                                </div>
                              )}
                              {a.rubric && <div className="assignment-rubric">Rubric: {a.rubric}</div>}
                              <div className="member-meta">
                                Submissions: {a.submission_count || 0}
                                {a.viewer_submission_status ? ` • Your status: ${a.viewer_submission_status}` : ""}
                                {a.viewer_submission_score !== null && a.viewer_submission_score !== undefined ? ` • Score: ${a.viewer_submission_score}` : ""}
                                {attempts > 0 ? ` • Attempts: ${attempts}/2` : ""}
                              </div>
                              {a.viewer_submission_content && (
                                <div className="assignment-my-submission">
                                  <div className="assignment-my-submission-title">
                                    Your latest submission
                                    {a.viewer_submitted_at
                                      ? ` • ${new Date(a.viewer_submitted_at).toLocaleString()}`
                                      : ""}
                                  </div>
                                  <div className="assignment-body">{a.viewer_submission_content}</div>
                                </div>
                              )}
                              {!isCommunityMod && Number(activeCommunity.is_member) === 1 && (
                                <>
                                  {!submissionLocked && !gradedLocked ? (
                                    <div className="assignment-submit-row">
                                      <textarea
                                        placeholder="Write your answer/submission"
                                        value={draftValue || persistedDraft}
                                        onChange={(e) =>
                                          setSubmissionDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))
                                        }
                                        disabled={pastDue}
                                      />
                                      <div className="assignment-submit-actions">
                                        <button className="assignment-save-draft-btn" type="button" onClick={() => saveAssignmentDraft(a.id)} disabled={pastDue}>
                                          Save Draft
                                        </button>
                                        <button onClick={() => submitAssignment(a.id)} disabled={pastDue}>
                                          {viewerStatus ? "Resubmit" : "Submit"}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="assignment-lock-note">
                                      {gradedLocked
                                        ? "Assignment already graded. Resubmission is closed."
                                        : "Submission locked: you already used 2/2 attempts."}
                                    </div>
                                  )}
                                </>
                              )}
                              {isCommunityMod && (
                                <div className="assignment-mod-row">
                                  <button onClick={() => toggleAssignmentReview(a.id)}>
                                    {selectedAssignmentId === a.id ? "Hide submissions" : "Review submissions"}
                                  </button>
                                  <button
                                    className="assignment-delete-btn"
                                    onClick={() => deleteAssignment(a.id)}
                                  >
                                    Delete assignment
                                  </button>
                                </div>
                              )}
                              {isCommunityMod && selectedAssignmentId === a.id && (
                                <div className="assignment-submissions">
                                  <div className="assignment-submissions-head">
                                    <strong>Submissions</strong>
                                    <button
                                      type="button"
                                      className="assignment-submissions-close"
                                      onClick={() => toggleAssignmentReview(a.id)}
                                    >
                                      Close
                                    </button>
                                  </div>
                                  {assignmentSubmissions.length === 0 ? (
                                    <div className="community-empty">No submissions yet.</div>
                                  ) : (
                                    assignmentSubmissions.map((s) => {
                                      const draft = gradingDrafts[s.id] || { score: "", feedback: "", status: "graded" };
                                      const gradeLocked =
                                        Boolean(s.graded_at) ||
                                        s.score !== null && s.score !== undefined ||
                                        ["graded", "needs_revision", "missing"].includes(
                                          String(s.status || "").toLowerCase()
                                        );
                                      return (
                                        <div key={s.id} className="assignment-submission-item">
                                          <div className="assignment-submission-head">
                                            <img
                                              src={s.avatar_url ? (s.avatar_url.startsWith("http") ? s.avatar_url : `${API}${s.avatar_url}`) : DEFAULT_AVATAR}
                                              alt={s.username}
                                              onError={(e) => {
                                                e.currentTarget.src = DEFAULT_AVATAR;
                                              }}
                                            />
                                            <div>
                                              <div className="member-name">{s.display_name || s.username}</div>
                                              <div className="member-meta">@{s.username} • {new Date(s.submitted_at).toLocaleString()}</div>
                                            </div>
                                          </div>
                                          <div className="assignment-body">{s.content || "No content"}</div>
                                          {gradeLocked && (
                                            <div className="assignment-lock-note">
                                              Grade finalized. This submission is locked.
                                            </div>
                                          )}
                                          <div className="assignment-grade-grid">
                                            <input
                                              type="number"
                                              step="0.1"
                                              min={0}
                                              max={Number(a.points) > 0 ? a.points : undefined}
                                              value={draft.score}
                                              onChange={(e) =>
                                                setGradingDrafts((prev) => ({
                                                  ...prev,
                                                  [s.id]: { ...draft, score: e.target.value },
                                                }))
                                              }
                                              placeholder="Score"
                                              disabled={gradeLocked}
                                            />
                                            <select
                                              value={draft.status || "graded"}
                                              onChange={(e) =>
                                                setGradingDrafts((prev) => ({
                                                  ...prev,
                                                  [s.id]: { ...draft, status: e.target.value },
                                                }))
                                              }
                                              disabled={gradeLocked}
                                            >
                                              <option value="graded">graded</option>
                                              <option value="needs_revision">needs revision</option>
                                              <option value="missing">missing</option>
                                            </select>
                                            <textarea
                                              placeholder="Feedback"
                                              value={draft.feedback || ""}
                                              onChange={(e) =>
                                                setGradingDrafts((prev) => ({
                                                  ...prev,
                                                  [s.id]: { ...draft, feedback: e.target.value },
                                                }))
                                              }
                                              disabled={gradeLocked}
                                            />
                                            <button onClick={() => gradeSubmission(s.id)} disabled={gradeLocked}>
                                              Save Grade
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                    <div className="assignment-badges-panel">
                      <h5>Badges & Streaks</h5>
                      {badgesStreaks.length === 0 ? (
                        <div className="community-empty">No learner streak data yet.</div>
                      ) : (
                        <div className="assignment-badges-list">
                          {badgesStreaks.map((row) => (
                            <button
                              key={`badge-${row.id}`}
                              className="assignment-badge-row"
                              onClick={() => navigate(`/vine/profile/${row.username}`)}
                            >
                              <img
                                src={
                                  row.avatar_url
                                    ? (row.avatar_url.startsWith("http") ? row.avatar_url : `${API}${row.avatar_url}`)
                                    : DEFAULT_AVATAR
                                }
                                alt={row.username}
                                onError={(e) => {
                                  e.currentTarget.src = DEFAULT_AVATAR;
                                }}
                              />
                              <div>
                                <div className="member-name">{row.display_name || row.username}</div>
                                <div className="member-meta">
                                  Streak: {row.current_streak || 0} • On-time: {row.total_on_time || 0} • Avg: {row.avg_score ?? "-"}{row.avg_percent !== null && row.avg_percent !== undefined ? ` (${row.avg_percent}%)` : ""}
                                </div>
                                <div className="assignment-badges-chips">
                                  {(row.badges || []).length > 0
                                    ? row.badges.map((b) => (
                                        <span key={`${row.id}-${b}`} className="assignment-badge-chip">{b}</span>
                                      ))
                                    : <span className="assignment-badge-chip muted">No badge yet</span>}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="assignment-badges-legend">
                        <h6>Legend</h6>
                        <div><strong>Streak:</strong> consecutive on-time submissions from the most recent assignments.</div>
                        <div><strong>On-time:</strong> total submissions made before or on due date.</div>
                        <div><strong>Avg:</strong> average of graded scores in this community.</div>
                        <div><span>🔥</span> On-Time Streak = streak of 3+</div>
                        <div><span>🎯</span> Perfect Score = at least one full score</div>
                        <div><span>📚</span> Consistent Learner = 5+ submissions</div>
                        <div><span>🏅</span> High Achiever = average 85%+ (min 3 graded)</div>
                      </div>
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
                      <input value="Only owner/moderators" disabled readOnly />
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
