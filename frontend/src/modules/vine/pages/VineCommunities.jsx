import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import VinePostCard from "./VinePostCard";
import "./VineCommunities.css";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import { touchVineActivity } from "../utils/vineAuth";
import { createClientRequestId } from "../../../utils/requestId";
import { getCurrentVinePostSource } from "../utils/postSource";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const POST_MAX_LENGTH = 5000;
const LEARNING_BADGE_ORDER = {
  "🎯 Perfect Score": 0,
  "🏅 High Achiever": 1,
  "🔥 On-Time Streak": 2,
  "📚 Consistent Learner": 3,
};

const sortLearningBadges = (badges) =>
  [...(Array.isArray(badges) ? badges : [])].sort((a, b) => {
    const aRank = LEARNING_BADGE_ORDER[a] ?? 99;
    const bRank = LEARNING_BADGE_ORDER[b] ?? 99;
    if (aRank !== bRank) return aRank - bRank;
    return String(a).localeCompare(String(b));
  });

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
  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("vine_user") || "{}");
    } catch {
      return {};
    }
  })();
  const navigate = useNavigate();
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const DEFAULT_AVATAR = "/default-avatar.png";
  const [communities, setCommunities] = useState([]);
  const [activeCommunity, setActiveCommunity] = useState(null);
  const [posts, setPosts] = useState([]);
  const [members, setMembers] = useState([]);
  const [activeTab, setActiveTab] = useState("announcements");
  const [joinPolicy, setJoinPolicy] = useState("open");
  const [autoWelcomeEnabled, setAutoWelcomeEnabled] = useState(true);
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [pendingRequests, setPendingRequests] = useState([]);
  const [postText, setPostText] = useState("");
  const [communityFiles, setCommunityFiles] = useState([]);
  const [isSubmittingCommunityPost, setIsSubmittingCommunityPost] = useState(false);
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
  const [assignmentType, setAssignmentType] = useState("theory");
  const [assignmentDueAt, setAssignmentDueAt] = useState("");
  const [assignmentPoints, setAssignmentPoints] = useState(100);
  const [assignmentRubric, setAssignmentRubric] = useState("");
  const [assignmentFile, setAssignmentFile] = useState(null);
  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryTitle, setLibraryTitle] = useState("");
  const [libraryFile, setLibraryFile] = useState(null);
  const [submissionDrafts, setSubmissionDrafts] = useState({});
  const [submissionFiles, setSubmissionFiles] = useState({});
  const [savedDraftsMap, setSavedDraftsMap] = useState({});
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(null);
  const [assignmentSubmissions, setAssignmentSubmissions] = useState([]);
  const [gradingDrafts, setGradingDrafts] = useState({});
  const [badgesStreaks, setBadgesStreaks] = useState([]);
  const [progressRows, setProgressRows] = useState([]);
  const [deadlineEdits, setDeadlineEdits] = useState({});
  const [reputation, setReputation] = useState([]);
  const [reports, setReports] = useState([]);
  const [topicFilter, setTopicFilter] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [communityAvatarFile, setCommunityAvatarFile] = useState(null);
  const [communityBannerFile, setCommunityBannerFile] = useState(null);
  const [communityBannerOffset, setCommunityBannerOffset] = useState(0);
  const [isAdjustingCommunityBanner, setIsAdjustingCommunityBanner] = useState(false);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [announcementText, setAnnouncementText] = useState("");
  const [editingAnnouncementId, setEditingAnnouncementId] = useState(null);
  const [editingAnnouncementText, setEditingAnnouncementText] = useState("");
  const [sessionCreateNotice, setSessionCreateNotice] = useState("");
  const [assignmentDeleteTarget, setAssignmentDeleteTarget] = useState(null);
  const [communitySuccessModal, setCommunitySuccessModal] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [seenAnnouncementIds, setSeenAnnouncementIds] = useState({});
  const communityBannerDragStart = useRef(0);
  const communityBannerOffsetStart = useRef(0);
  const sessionCreateNoticeTimerRef = useRef(null);
  const communityPostRef = useRef(null);
  const communityPostRequestIdRef = useRef("");
  const communityPostFingerprintRef = useRef("");
  const assignmentFileInputRef = useRef(null);
  const libraryFileInputRef = useRef(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const canManageCommunitySettings = ["owner", "moderator"].includes(
    String(activeCommunity?.viewer_role || "").toLowerCase()
  );
  const pendingRequestCount = pendingRequests.length;
  const memberBadgesById = badgesStreaks.reduce((acc, row) => {
    acc[Number(row.id)] = sortLearningBadges(row.badges);
    return acc;
  }, {});

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      if (sessionCreateNoticeTimerRef.current) {
        window.clearTimeout(sessionCreateNoticeTimerRef.current);
      }
    },
    []
  );

  const showSessionCreateNotice = (message) => {
    if (sessionCreateNoticeTimerRef.current) {
      window.clearTimeout(sessionCreateNoticeTimerRef.current);
      sessionCreateNoticeTimerRef.current = null;
    }
    setSessionCreateNotice(message);
    sessionCreateNoticeTimerRef.current = window.setTimeout(() => {
      setSessionCreateNotice("");
      sessionCreateNoticeTimerRef.current = null;
    }, 3200);
  };

  const showCommunitySuccessModal = (title, message, options = {}) => {
    setCommunitySuccessModal({
      title: String(title || "Done"),
      message: String(message || "").trim(),
      kicker: String(options.kicker || "All set"),
      buttonLabel: String(options.buttonLabel || "Okay"),
      tone: options.tone === "warning" ? "warning" : "success",
    });
  };

  useEffect(() => {
    if (activeCommunity?.name) {
      document.title = `Vine — ${activeCommunity.name}`;
      return;
    }
    document.title = "Vine — Communities";
  }, [activeCommunity?.name]);

  const communityPostFingerprint = [
    postText.trim(),
    communityFiles.map((file) => `${file?.name || ""}:${file?.size || 0}:${file?.lastModified || 0}`).join("|"),
    String(activeCommunity?.id || ""),
  ].join("::");

  useEffect(() => {
    if (
      communityPostFingerprintRef.current &&
      communityPostFingerprintRef.current !== communityPostFingerprint
    ) {
      communityPostRequestIdRef.current = "";
    }
    communityPostFingerprintRef.current = communityPostFingerprint;
  }, [communityPostFingerprint]);

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
      setLibraryItems([]);
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
        setLibraryItems([]);
        return;
      }

      const [pRes, mRes, rulesRes, questionsRes, eventsRes, mediaRes, assignmentsRes, libraryRes] = await Promise.all([
        fetch(
          `${API}/api/vine/communities/${encodeURIComponent(communitySlug)}/posts${nextTopic ? `?topic=${encodeURIComponent(nextTopic)}` : ""}`,
          { headers: { Authorization: `Bearer ${token}` } }
        ),
        fetch(`${API}/api/vine/communities/${encodeURIComponent(communitySlug)}/members?limit=500`, {
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
        fetch(`${API}/api/vine/communities/${encodeURIComponent(communitySlug)}/library`, {
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
      const libraryData = await libraryRes.json().catch(() => []);
      setActiveCommunity(cData);
      setPosts(Array.isArray(pData) ? pData : []);
      setMembers(Array.isArray(mData) ? mData : []);
      setRules(Array.isArray(rulesData) ? rulesData : []);
      setQuestions(Array.isArray(qData) ? qData : []);
      setEvents(Array.isArray(eventsData) ? eventsData : []);
      setMediaPosts(Array.isArray(mediaData) ? mediaData : []);
      const safeAssignments = Array.isArray(assignmentsData) ? assignmentsData : [];
      setAssignments(safeAssignments);
      setLibraryItems(Array.isArray(libraryData) ? libraryData : []);
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
      setCommunityBannerOffset(Number(cData?.banner_offset_y || 0));
      setIsAdjustingCommunityBanner(false);
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
      setLibraryItems([]);
      setSavedDraftsMap({});
      setCommunityBannerOffset(0);
      setIsAdjustingCommunityBanner(false);
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
      "about",
      "members",
      "attendance",
      "assignments",
      "library",
      "settings",
      "announcements",
    ]);
    if (allowed.has(tab)) {
      setActiveTab(tab);
    } else {
      setActiveTab("announcements");
    }
  }, [searchParams]);

  const createCommunity = async () => {
    const trimmedName = name.trim();
    if (!canCreateCommunity) {
      alert("Only existing community owners can create new communities");
      return;
    }
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

  const loadProgress = async () => {
    if (!activeCommunity?.id) return;
    const role = String(activeCommunity?.viewer_role || "").toLowerCase();
    if (!["owner", "moderator"].includes(role)) {
      setProgressRows([]);
      return;
    }
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/progress`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setProgressRows(Array.isArray(data) ? data : []);
    } catch {
      setProgressRows([]);
    }
  };

  const loadAssignmentSubmissions = async (assignmentId) => {
    if (!activeCommunity?.id || !assignmentId) return;
    const viewerRole = String(activeCommunity?.viewer_role || "").toLowerCase();
    if (viewerRole !== "owner") {
      setAssignmentSubmissions([]);
      setGradingDrafts({});
      return;
    }
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
      if (String(activeCommunity.viewer_role || "").toLowerCase() === "owner") {
        loadScheduledPosts();
      }
    }
  }, [activeTab, activeCommunity?.id, activeCommunity?.viewer_role]);

  useEffect(() => {
    if (!activeCommunity?.id || !canManageCommunitySettings) {
      setPendingRequests([]);
      return;
    }
    loadRequests();
    const interval = setInterval(loadRequests, 25000);
    return () => clearInterval(interval);
  }, [activeCommunity?.id, canManageCommunitySettings]);

  useEffect(() => {
    if ((activeTab === "assignments" || activeTab === "members") && activeCommunity?.id) loadBadgesStreaks();
    if (activeTab === "announcements" && activeCommunity?.id) loadProgress();
    if (activeTab === "attendance" && activeCommunity?.id) {
      const role = String(activeCommunity.viewer_role || "").toLowerCase();
      if (["owner", "moderator"].includes(role)) {
        loadSessions();
        if (role === "moderator") loadAttendanceRecords();
      } else {
        loadAttendanceRecords();
      }
    }
    if (activeTab === "reports" && activeCommunity && ["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase())) {
      loadReports();
    }
  }, [activeTab, activeCommunity?.id, activeCommunity?.viewer_role]);

  useEffect(() => {
    const now = new Date();
    setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  }, [activeCommunity?.id]);

  useEffect(() => {
    if (!activeCommunity?.id || !currentUser?.id) {
      setSeenAnnouncementIds({});
      return;
    }
    try {
      const key = `vine_announcements_seen_${currentUser.id}_${activeCommunity.id}`;
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : {};
      setSeenAnnouncementIds(parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      setSeenAnnouncementIds({});
    }
  }, [activeCommunity?.id, currentUser?.id]);

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

  const startCommunityBannerDrag = (e) => {
    if (!isAdjustingCommunityBanner) return;
    communityBannerDragStart.current = e.touches ? e.touches[0].clientY : e.clientY;
    communityBannerOffsetStart.current = Number(communityBannerOffset || 0);
  };

  const onCommunityBannerDrag = (e) => {
    if (!isAdjustingCommunityBanner) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const delta = y - communityBannerDragStart.current;
    const next = Math.max(-260, Math.min(260, communityBannerOffsetStart.current + delta));
    setCommunityBannerOffset(next);
  };

  const stopCommunityBannerDrag = async () => {
    if (!isAdjustingCommunityBanner || !activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/banner-position`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ offsetY: Math.round(communityBannerOffset) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to save banner position");
        return;
      }
      setCommunityBannerOffset(Number(data.banner_offset_y ?? Math.round(communityBannerOffset)));
      setIsAdjustingCommunityBanner(false);
      setActiveCommunity((prev) =>
        prev
          ? {
              ...prev,
              banner_offset_y: Number(data.banner_offset_y ?? Math.round(communityBannerOffset)),
            }
          : prev
      );
      await loadCommunities();
    } catch {
      alert("Failed to save banner position");
    }
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
    if (isSubmittingCommunityPost) return;
    if ((!postText.trim() && communityFiles.length === 0) || !activeCommunity?.id) return;
    try {
      setIsSubmittingCommunityPost(true);
      const formData = new FormData();
      if (postText.trim()) formData.append("content", postText.trim());
      const postSourceLabel = getCurrentVinePostSource();
      if (postSourceLabel) formData.append("post_source_label", postSourceLabel);
      formData.append("community_id", String(activeCommunity.id));
      const clientRequestId =
        communityPostRequestIdRef.current || createClientRequestId("community-post");
      communityPostRequestIdRef.current = clientRequestId;
      formData.append("client_request_id", clientRequestId);
      communityFiles.forEach((file) => formData.append("images", file));

      const res = await fetch(`${API}/api/vine/posts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const responsePost = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(responsePost.message || "Failed to post");
        return;
      }
      const data =
        postSourceLabel && !responsePost?.post_source_label
          ? { ...responsePost, post_source_label: postSourceLabel }
          : responsePost;
      setPostText("");
      setCommunityFiles([]);
      setPosts((prev) => {
        const alreadyThere = prev.some((row) => Number(row?.id) === Number(data?.id));
        if (alreadyThere) {
          return prev.map((row) => (Number(row?.id) === Number(data?.id) ? { ...row, ...data } : row));
        }
        return [data, ...prev];
      });
      communityPostRequestIdRef.current = "";
      communityPostFingerprintRef.current = "";
    } catch {
      alert("Failed to post");
    } finally {
      setIsSubmittingCommunityPost(false);
    }
  };

  const createAssignment = async () => {
    if (!activeCommunity?.id || !assignmentTitle.trim()) return;
    const viewerRole = String(activeCommunity?.viewer_role || "").toLowerCase();
    if (viewerRole !== "owner") {
      alert("Only community owner can create assignments");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("title", assignmentTitle.trim());
      formData.append("instructions", assignmentInstructions.trim());
      formData.append("assignment_type", assignmentType);
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
      setAssignmentType("theory");
      setAssignmentDueAt("");
      setAssignmentPoints(100);
      setAssignmentRubric("");
      setAssignmentFile(null);
      await loadCommunityDetail(activeCommunity.slug, topicFilter);
      showSessionCreateNotice("Assignment created. Learners can now see it under Assignments.");
    } catch {
      alert("Failed to create assignment");
    }
  };

  const submitAssignment = async (assignmentId, assignmentTypeValue = "theory") => {
    if (!activeCommunity?.id || !assignmentId) return;
    const text = String(submissionDrafts[assignmentId] || savedDraftsMap[assignmentId] || "").trim();
    const files = Array.isArray(submissionFiles[assignmentId]) ? submissionFiles[assignmentId] : [];
    const isPractical = String(assignmentTypeValue || "theory").toLowerCase() === "practical";
    if (!text && files.length === 0) {
      showCommunitySuccessModal(
        "Write your answer first",
        isPractical
          ? "Add your answer or attach your work before submitting this assignment."
          : "Add your answer before submitting this assignment.",
        { kicker: "Heads up", tone: "warning" }
      );
      return;
    }
    try {
      const formData = new FormData();
      if (text) formData.append("content", text);
      if (isPractical && files.length > 0) {
        files.forEach((file) => formData.append("submission_files", file));
      }
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/assignments/${assignmentId}/submissions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to submit assignment");
        return;
      }
      setSubmissionDrafts((prev) => ({ ...prev, [assignmentId]: "" }));
      setSavedDraftsMap((prev) => ({ ...prev, [assignmentId]: "" }));
      setSubmissionFiles((prev) => ({ ...prev, [assignmentId]: [] }));
      await loadCommunityDetail(activeCommunity.slug, topicFilter);
      showCommunitySuccessModal(
        "Assignment submitted",
        "Your work is now safely in and ready for the class owner to review."
      );
    } catch {
      alert("Failed to submit assignment");
    }
  };

  const saveAssignmentDraft = async (assignmentId) => {
    if (!activeCommunity?.id || !assignmentId) return;
    const text = String(submissionDrafts[assignmentId] || "").trim();
    if (!text) {
      showCommunitySuccessModal(
        "Write your answer first",
        "Add your answer before saving this draft.",
        { kicker: "Heads up", tone: "warning" }
      );
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
      showCommunitySuccessModal(
        "Draft saved",
        "Your work is safely saved. You can come back and finish it anytime."
      );
    } catch {
      alert("Failed to save draft");
    }
  };

  const deleteAssignment = async (assignment) => {
    const assignmentId = Number(
      typeof assignment === "object" && assignment !== null ? assignment.id : assignment
    );
    if (!activeCommunity?.id || !assignmentId) return;
    const viewerRole = String(activeCommunity?.viewer_role || "").toLowerCase();
    if (viewerRole !== "owner") {
      alert("Only community owner can delete assignments");
      return;
    }
    setAssignmentDeleteTarget({
      id: assignmentId,
      title:
        typeof assignment === "object" && assignment !== null
          ? String(assignment.title || "").trim()
          : "",
    });
  };

  const confirmDeleteAssignment = async () => {
    const assignmentId = Number(assignmentDeleteTarget?.id || 0);
    if (!activeCommunity?.id || !assignmentId) {
      setAssignmentDeleteTarget(null);
      return;
    }
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
      setAssignmentDeleteTarget(null);
      showSessionCreateNotice("Assignment deleted. It has been removed from the class.");
    } catch {
      alert("Failed to delete assignment");
    }
  };

  const deletePracticalSubmissionFile = async (assignmentId, fileId) => {
    if (!activeCommunity?.id || !assignmentId || !fileId) return;
    try {
      const res = await fetch(
        `${API}/api/vine/communities/${activeCommunity.id}/assignments/${assignmentId}/submission-files/${fileId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to delete file");
        return;
      }
      await loadCommunityDetail(activeCommunity.slug, topicFilter);
    } catch {
      alert("Failed to delete file");
    }
  };

  const gradeSubmission = async (submissionId) => {
    if (!activeCommunity?.id || !submissionId) return;
    const viewerRole = String(activeCommunity?.viewer_role || "").toLowerCase();
    if (viewerRole !== "owner") {
      alert("Only community owner can grade assignments");
      return;
    }
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

  const exportGradebookPdf = async () => {
    if (!activeCommunity?.id) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/gradebook`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        alert("Failed to export PDF");
        return;
      }
      const rows = await res.json().catch(() => []);
      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const safeRows = Array.isArray(rows) ? rows : [];
      const grouped = safeRows.reduce((acc, row) => {
        const key = String(row.assignment_id || "0");
        if (!acc[key]) acc[key] = [];
        acc[key].push(row);
        return acc;
      }, {});
      const sections = Object.values(grouped);

      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(14);
      doc.setTextColor(6, 78, 59);
      doc.text("ST. PHILLIPS EQUATORIAL SECONDARY SCHOOL", pageWidth / 2, 26, { align: "center" });
      doc.setFontSize(9);
      doc.setTextColor(30, 64, 175);
      doc.text("info@stphillipsequatorial.com", pageWidth / 2, 40, { align: "center" });
      doc.setDrawColor(167, 243, 208);
      doc.line(40, 48, pageWidth - 40, 48);
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(12);
      doc.text(`${activeCommunity?.name || "Community"} — Gradebook`, 40, 62);

      if (sections.length === 0) {
        doc.setFontSize(11);
        doc.text("No gradebook records available.", 40, 82);
      } else {
        let cursorY = 80;
        sections.forEach((group, index) => {
          const first = group[0] || {};
          const assignmentTitle = first.assignment_title || `Assignment ${first.assignment_id || ""}`;
          const dueText = first.assignment_due_at
            ? new Date(first.assignment_due_at).toLocaleString()
            : "No due date";
          const pointsText = first.assignment_points ?? "-";
          const submittedLearners = group
            .filter((r) => r.submission_id !== null && r.submission_id !== undefined)
            .map((r) => r.learner_display_name || r.learner_username || "Unknown");
          const missingLearners = group
            .filter((r) => r.submission_id === null || r.submission_id === undefined)
            .map((r) => r.learner_display_name || r.learner_username || "Unknown");

          if (index > 0) {
            doc.addPage();
            const nextPageWidth = doc.internal.pageSize.getWidth();
            doc.setFontSize(14);
            doc.setTextColor(6, 78, 59);
            doc.text("ST. PHILLIPS EQUATORIAL SECONDARY SCHOOL", nextPageWidth / 2, 26, { align: "center" });
            doc.setFontSize(9);
            doc.setTextColor(30, 64, 175);
            doc.text("info@stphillipsequatorial.com", nextPageWidth / 2, 40, { align: "center" });
            doc.setDrawColor(167, 243, 208);
            doc.line(40, 48, nextPageWidth - 40, 48);
            doc.setTextColor(15, 23, 42);
            cursorY = 66;
          }

          doc.setFontSize(11);
          doc.text(`Assignment: ${assignmentTitle}`, 40, cursorY);
          doc.setFontSize(9);
          doc.text(`Due: ${dueText}   •   Points: ${pointsText}`, 40, cursorY + 14);

          autoTable(doc, {
            startY: cursorY + 22,
            head: [["Learner", "Score", "Status", "Submitted", "Graded"]],
            body: group.map((r) => {
              const hasSubmission = r.submission_id !== null && r.submission_id !== undefined;
              const dueAt = r.assignment_due_at ? new Date(r.assignment_due_at) : null;
              const deadlinePassed = dueAt && !Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now();
              const submittedText = hasSubmission
                ? (r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "-")
                : (deadlinePassed ? "Missed assignment" : "-");
              const gradedText = r.graded_at
                ? new Date(r.graded_at).toLocaleString()
                : (!hasSubmission && deadlinePassed ? "Ungraded" : "Pending");
              const statusText = hasSubmission
                ? (r.submission_status || "pending")
                : (deadlinePassed ? "missing" : "pending");

              return [
                r.learner_display_name || r.learner_username || "",
                r.submission_score ?? "-",
                statusText,
                submittedText,
                gradedText,
              ];
            }),
            styles: { fontSize: 8, cellPadding: 4 },
            headStyles: { fillColor: [6, 95, 70] },
          });

          const tableEndY = doc.lastAutoTable?.finalY || (cursorY + 22);
          const totalLearners = group.length;
          const submittedCount = submittedLearners.length;
          const missingCount = missingLearners.length;
          doc.setFontSize(8);
          doc.text(
            `Class stats — Total learners: ${totalLearners} | Submitted: ${submittedCount} | Never submitted: ${missingCount}`,
            40,
            tableEndY + 14
          );
          const submittedText = `Submitted by: ${submittedLearners.length ? submittedLearners.join(", ") : "None"}`;
          const missedText = `Never submitted: ${missingLearners.length ? missingLearners.join(", ") : "None"}`;
          const submittedLines = doc.splitTextToSize(submittedText, 515);
          const missedLines = doc.splitTextToSize(missedText, 515);
          doc.text(submittedLines, 40, tableEndY + 28);
          doc.text(missedLines, 40, tableEndY + 28 + (submittedLines.length * 10));
        });
      }
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
    } catch {
      alert("Failed to export PDF");
    }
  };

  const exportSubmittedWorkPdf = async (assignment) => {
    if (!activeCommunity?.id || !assignment?.id) return;
    if (String(activeCommunity?.viewer_role || "").toLowerCase() !== "owner") {
      alert("Only community owner can export submitted work");
      return;
    }
    if (String(assignment.assignment_type || "theory").toLowerCase() !== "theory") {
      alert("Submitted work PDF is available for theory assignments only");
      return;
    }
    try {
      const res = await fetch(
        `${API}/api/vine/communities/${activeCommunity.id}/assignments/${assignment.id}/submissions`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        alert("Failed to load submissions");
        return;
      }
      const rows = await res.json().catch(() => []);
      const submissions = Array.isArray(rows) ? rows : [];
      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const drawSchoolHeader = () => {
        doc.setFontSize(14);
        doc.setTextColor(6, 78, 59);
        doc.text("ST. PHILLIPS EQUATORIAL SECONDARY SCHOOL", pageWidth / 2, 24, { align: "center" });
        doc.setFontSize(9);
        doc.setTextColor(30, 64, 175);
        doc.text("info@stphillipsequatorial.com", pageWidth / 2, 38, { align: "center" });
        doc.setDrawColor(167, 243, 208);
        doc.line(40, 46, pageWidth - 40, 46);
        doc.setTextColor(15, 23, 42);
      };

      if (submissions.length === 0) {
        drawSchoolHeader();
        doc.setFontSize(13);
        doc.text(`${assignment.title || "Assignment"} — Submitted Work`, pageWidth / 2, 66, { align: "center" });
        doc.setFontSize(11);
        doc.text("No submissions yet.", 40, 96);
      } else {
        submissions.forEach((s, idx) => {
          if (idx > 0) doc.addPage();
          drawSchoolHeader();
          doc.setFontSize(13);
          doc.text(`${assignment.title || "Assignment"} — Submitted Work`, pageWidth / 2, 62, { align: "center" });
          doc.setFontSize(10);
          doc.text(`Learner: ${s.display_name || s.username || "Unknown"} (@${s.username || "-"})`, 40, 86);
          doc.text(`Submitted: ${s.submitted_at ? new Date(s.submitted_at).toLocaleString() : "-"}`, 40, 102);
          doc.text(`Score: ${s.score === null || s.score === undefined ? "Pending" : s.score}`, 40, 118);
          doc.text(`Status: ${s.status || "submitted"}`, 40, 134);
          autoTable(doc, {
            startY: 150,
            head: [["Submitted Work"]],
            body: [[String(s.content || "No written content submitted.")]],
            styles: { fontSize: 10, cellPadding: 8, valign: "top" },
            headStyles: { fillColor: [6, 95, 70] },
            bodyStyles: { minCellHeight: 330 },
          });
          const tableEndY = doc.lastAutoTable?.finalY || 500;
          doc.setFontSize(10);
          doc.text("Teacher Comment:", 40, tableEndY + 20);
          const feedbackText = String(s.feedback || "").trim() || "No comment.";
          const feedbackLines = doc.splitTextToSize(feedbackText, pageWidth - 80);
          doc.setFontSize(9);
          doc.text(feedbackLines, 40, tableEndY + 36);
        });
      }

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
    } catch {
      alert("Failed to export submitted work");
    }
  };

  const markAnnouncementRead = (postId) => {
    if (!activeCommunity?.id || !currentUser?.id || !postId) return;
    const next = { ...seenAnnouncementIds, [postId]: Date.now() };
    setSeenAnnouncementIds(next);
    try {
      const key = `vine_announcements_seen_${currentUser.id}_${activeCommunity.id}`;
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // no-op
    }
  };

  const createAnnouncement = async () => {
    if (!activeCommunity?.id || !announcementText.trim()) return;
    const viewerRole = String(activeCommunity?.viewer_role || "").toLowerCase();
    if (viewerRole !== "owner") {
      alert("Only the community owner can create announcements");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("content", announcementText.trim());
      formData.append("community_id", String(activeCommunity.id));

      const postRes = await fetch(`${API}/api/vine/posts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const postData = await postRes.json().catch(() => ({}));
      if (!postRes.ok || !postData?.id) {
        alert(postData.message || "Failed to create announcement");
        return;
      }

      const pinRes = await fetch(
        `${API}/api/vine/communities/${activeCommunity.id}/posts/${postData.id}/pin`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!pinRes.ok) {
        alert("Announcement posted, but failed to pin.");
      }
      setAnnouncementText("");
      await loadCommunityDetail(activeCommunity.slug, topicFilter);
    } catch {
      alert("Failed to create announcement");
    }
  };

  const toDatetimeLocalValue = (value) => {
    if (!value) return "";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  };

  const extendAssignmentDeadline = async (assignmentId) => {
    if (!activeCommunity?.id || !assignmentId) return;
    const nextDueAt = String(deadlineEdits[assignmentId] || "").trim();
    if (!nextDueAt) {
      alert("Pick a new deadline first");
      return;
    }
    try {
      const res = await fetch(
        `${API}/api/vine/communities/${activeCommunity.id}/assignments/${assignmentId}/deadline`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ due_at: nextDueAt }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to extend deadline");
        return;
      }
      await loadCommunityDetail(activeCommunity.slug, topicFilter);
      alert("Deadline extended");
    } catch {
      alert("Failed to extend deadline");
    }
  };

  const uploadLibraryPdf = async () => {
    if (!activeCommunity?.id) return;
    if (!libraryTitle.trim() || !libraryFile) {
      alert("Add title and pick a PDF");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("title", libraryTitle.trim());
      formData.append("library_pdf", libraryFile);
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/library`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to upload PDF");
        return;
      }
      setLibraryTitle("");
      setLibraryFile(null);
      if (libraryFileInputRef.current) libraryFileInputRef.current.value = "";
      await loadCommunityDetail(activeCommunity.slug, topicFilter);
    } catch {
      alert("Failed to upload PDF");
    }
  };

  const deleteLibraryItem = async (itemId) => {
    if (!activeCommunity?.id || !itemId) return;
    const ok = window.confirm("Remove this PDF from library?");
    if (!ok) return;
    try {
      const res = await fetch(`${API}/api/vine/communities/${activeCommunity.id}/library/${itemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        alert("Failed to remove PDF");
        return;
      }
      await loadCommunityDetail(activeCommunity.slug, topicFilter);
    } catch {
      alert("Failed to remove PDF");
    }
  };

  const toggleAssignmentReview = async (assignmentId) => {
    if (!assignmentId) return;
    const viewerRole = String(activeCommunity?.viewer_role || "").toLowerCase();
    if (viewerRole !== "owner") return;
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
      showSessionCreateNotice("Class session created. Learners can now see it in Attendance.");
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
    if (isSelectedSessionClosed) {
      alert("This session has ended. Attendance is locked.");
      return;
    }
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
      if (String(activeCommunity?.viewer_role || "").toLowerCase() === "moderator") {
        await loadAttendanceRecords();
      }
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

  const exportAttendancePdf = async () => {
    if (!selectedSessionId) return;
    const session = sessions.find((s) => Number(s.id) === Number(selectedSessionId));
    const { jsPDF, autoTable } = await loadPdfTools();
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const normalizedRows = attendanceRows.filter(
      (row) => String(row.community_role || "").toLowerCase() !== "owner"
    );
    const withStatus = normalizedRows.map((row) => ({
      ...row,
      _status: String(attendanceDrafts[row.user_id] || row.status || "absent").toLowerCase(),
    }));
    const formatAttendanceStatus = (value) => {
      const normalized = String(value || "absent").toLowerCase();
      if (!normalized) return "Absent";
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    };
    const presentRows = withStatus.filter((row) => row._status === "present");
    const lateRows = withStatus.filter((row) => row._status === "late");
    const excusedRows = withStatus.filter((row) => row._status === "excused");
    const absentRows = withStatus.filter((row) => row._status === "absent");
    const ownerRow = attendanceRows.find(
      (row) => String(row.community_role || "").toLowerCase() === "owner"
    );
    const teacherName = ownerRow?.display_name || ownerRow?.username || "Class Teacher";
    const moderatorName = currentUser?.display_name || currentUser?.username || "Moderator";
    const totalLearners = normalizedRows.length;
    const totalPresent = presentRows.length;
    const totalLate = lateRows.length;
    const totalExcused = excusedRows.length;
    const totalAbsent = absentRows.length;

    doc.setFontSize(16);
    doc.text("ST. PHILLIPS EQUATORIAL SECONDARY SCHOOL", 40, 42);
    doc.setFontSize(11);
    doc.text(`${activeCommunity?.name || "Community"} - Register`, 40, 62);
    doc.text(`Session: ${session?.title || "Untitled"}`, 40, 78);
    doc.text(`Date: ${session?.starts_at ? new Date(session.starts_at).toLocaleString() : ""}`, 40, 94);
    const signingBody = withStatus.map((row, idx) => [
      idx + 1,
      row.display_name || row.username || "",
      `@${row.username || ""}`,
      formatAttendanceStatus(row._status),
      "__________________________",
    ]);

    autoTable(doc, {
      startY: 108,
      head: [["No", "Name", "Username", "Status", "Signature"]],
      body: signingBody.length ? signingBody : [["-", "No learners listed", "-", "-", "-"]],
      theme: "grid",
      styles: {
        fontSize: 10,
        cellPadding: 7,
        lineColor: [120, 120, 120],
        lineWidth: 0.6,
        textColor: [0, 0, 0],
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        lineColor: [120, 120, 120],
        lineWidth: 0.6,
      },
      bodyStyles: { minCellHeight: 24 },
      columnStyles: {
        0: { cellWidth: 36, halign: "center" },
        3: { cellWidth: 68, halign: "center" },
        4: { cellWidth: 180 },
      },
    });

    const signTableEndY = doc.lastAutoTable?.finalY || 108;
    doc.setFontSize(12);
    doc.text("Follow-up List", 40, signTableEndY + 24);
    const followUpBody = withStatus
      .filter((row) => row._status !== "present")
      .map((row, idx) => [
        idx + 1,
        row.display_name || row.username || "",
        `@${row.username || ""}`,
        formatAttendanceStatus(row._status),
      ]);
    autoTable(doc, {
      startY: signTableEndY + 32,
      head: [["No", "Name", "Username", "Status"]],
      body: followUpBody.length ? followUpBody : [["-", "No follow-up needed", "-", "-"]],
      theme: "grid",
      styles: {
        fontSize: 10,
        cellPadding: 7,
        lineColor: [120, 120, 120],
        lineWidth: 0.6,
        textColor: [0, 0, 0],
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        lineColor: [120, 120, 120],
        lineWidth: 0.6,
      },
      columnStyles: {
        0: { cellWidth: 36, halign: "center" },
        3: { cellWidth: 68, halign: "center" },
      },
    });

    const absentTableEndY = doc.lastAutoTable?.finalY || signTableEndY + 32;
    doc.setFontSize(11);
    doc.text(`Total learners (group members): ${totalLearners}`, 40, absentTableEndY + 26);
    doc.text(`Learners present: ${totalPresent}`, 40, absentTableEndY + 44);
    doc.text(`Learners late: ${totalLate}`, 40, absentTableEndY + 62);
    doc.text(`Learners excused: ${totalExcused}`, 40, absentTableEndY + 80);
    doc.text(`Learners absent: ${totalAbsent}`, 40, absentTableEndY + 98);
    doc.text(`Class teacher signature: ${teacherName} ____________________`, 40, absentTableEndY + 126);
    doc.text(`Moderator (${moderatorName}) signature: ____________________`, 40, absentTableEndY + 148);

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
  const isCommunityOwner = String(activeCommunity?.viewer_role || "").toLowerCase() === "owner";
  const isCommunityModerator = String(activeCommunity?.viewer_role || "").toLowerCase() === "moderator";
  const isAttendanceManager = ["owner", "moderator"].includes(String(activeCommunity?.viewer_role || "").toLowerCase());
  const selectedSession = sessions.find((s) => Number(s.id) === Number(selectedSessionId));
  const isSelectedSessionClosed = Boolean(
    selectedSession?.ends_at &&
      !Number.isNaN(new Date(selectedSession.ends_at).getTime()) &&
      new Date(selectedSession.ends_at).getTime() <= nowMs
  );
  const canCreateCommunity = communities.some((c) => Number(c.creator_id) === Number(currentUser?.id));
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

  const formatSubmissionRelativeTime = (value) => {
    if (!value) return "";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "";
    const diffMs = Date.now() - dt.getTime();
    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;
    if (diffMs < hourMs) {
      const mins = Math.max(1, Math.floor(diffMs / minuteMs));
      return `${mins} ${mins === 1 ? "minute" : "minutes"} ago`;
    }
    if (diffMs < dayMs) {
      const hrs = Math.max(1, Math.floor(diffMs / hourMs));
      return `${hrs} ${hrs === 1 ? "hour" : "hours"} ago`;
    }
    const days = Math.max(1, Math.floor(diffMs / dayMs));
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  };

  const formatSimpleDate = (value) => {
    if (!value) return "";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getAssignmentDeadlineMeta = (value) => {
    const due = new Date(value);
    if (Number.isNaN(due.getTime())) return { label: "", tone: "ok" };
    const diffDays = Math.ceil((due.getTime() - nowMs) / (24 * 60 * 60 * 1000));
    if (diffDays < 0) return { label: "Overdue", tone: "overdue" };
    if (diffDays === 0) return { label: "Due", tone: "due" };
    if (diffDays <= 2) return { label: `D-${diffDays}`, tone: "soon" };
    if (diffDays <= 6) return { label: `D-${diffDays}`, tone: "watch" };
    return { label: `D-${diffDays}`, tone: "ok" };
  };

  const announcementPosts = posts.filter((p) => Number(p.is_community_pinned) === 1).slice(0, 5);
  const newAnnouncementCount = announcementPosts.filter((p) => !seenAnnouncementIds[p.id]).length;
  const announcementBadgeCount = isCommunityOwner ? 0 : newAnnouncementCount;
  const calendarItems = [
    ...assignments
      .filter((a) => a?.due_at)
      .map((a) => ({
        id: `a-${a.id}`,
        when: new Date(a.due_at),
        type: "assignment",
        title: a.title || "Assignment",
      })),
    ...sessions
      .filter((s) => s?.starts_at)
      .map((s) => ({
        id: `s-${s.id}`,
        when: new Date(s.starts_at),
        type: "session",
        title: s.title || "Class session",
      })),
  ]
    .filter((item) => !Number.isNaN(item.when.getTime()))
    .sort((a, b) => a.when.getTime() - b.when.getTime());

  const calendarStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const calendarEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);
  const firstWeekday = calendarStart.getDay();
  const monthDays = calendarEnd.getDate();
  const monthCells = [];
  for (let i = 0; i < firstWeekday; i += 1) monthCells.push(null);
  for (let d = 1; d <= monthDays; d += 1) monthCells.push(d);

  const calendarItemsByDay = calendarItems.reduce((acc, item) => {
    if (
      item.when.getFullYear() === calendarMonth.getFullYear() &&
      item.when.getMonth() === calendarMonth.getMonth()
    ) {
      const day = item.when.getDate();
      if (!acc[day]) acc[day] = [];
      acc[day].push(item);
    }
    return acc;
  }, {});
  Object.keys(calendarItemsByDay).forEach((k) => {
    calendarItemsByDay[k].sort((a, b) => {
      if (a.type === b.type) return a.when.getTime() - b.when.getTime();
      return a.type === "assignment" ? -1 : 1;
    });
  });
  const upcomingCalendarItems = calendarItems.filter((item) => item.when.getTime() >= nowMs).slice(0, 8);
  const nowDate = new Date(nowMs);
  const isCurrentMonthView =
    calendarMonth.getFullYear() === nowDate.getFullYear() &&
    calendarMonth.getMonth() === nowDate.getMonth();
  const monthAssignmentDays = assignments
    .filter((a) => a?.due_at)
    .map((a) => new Date(a.due_at))
    .filter((d) =>
      !Number.isNaN(d.getTime()) &&
      d.getFullYear() === calendarMonth.getFullYear() &&
      d.getMonth() === calendarMonth.getMonth()
    )
    .map((d) => d.getDate())
    .sort((a, b) => a - b);
  const timelineStartDay = monthAssignmentDays.length ? monthAssignmentDays[0] : null;
  const timelineEndDay = monthAssignmentDays.length > 1 ? monthAssignmentDays[monthAssignmentDays.length - 1] : timelineStartDay;
  const progressSummary = progressRows.reduce(
    (acc, row) => {
      acc.count += 1;
      acc.avgAttendance += Number(row.attendance_rate || 0);
      acc.avgSubmission += Number(row.submission_rate || 0);
      if (row.avg_score !== null && row.avg_score !== undefined) {
        acc.scoredCount += 1;
        acc.avgScore += Number(row.avg_score || 0);
      }
      if (String(row.risk_flag || "") === "at_risk") acc.atRisk += 1;
      return acc;
    },
    { count: 0, avgAttendance: 0, avgSubmission: 0, avgScore: 0, scoredCount: 0, atRisk: 0 }
  );

  return (
    <div className="vine-communities-page">
      <div className="communities-top">
        <button
          className="communities-back"
          onClick={() => navigate("/vine/feed")}
          aria-label="Back to feed"
        >
          <span className="communities-back-icon">←</span>
          <span className="communities-back-label">Feed</span>
        </button>
        <h2>{activeCommunity?.name ? activeCommunity.name : "Communities"}</h2>
      </div>

      <div className="communities-layout">
        <aside className="communities-sidebar">
          {canCreateCommunity && (
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
          )}

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
                {Number(c.is_member) === 1 ? (
                  <span className="community-join community-join-static">Joined</span>
                ) : (
                  <button className="community-join" onClick={() => toggleJoin(c)}>
                    {String(c.join_request_status || "") === "pending" ? "Requested" : "Join"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </aside>

        <main className="communities-main">
          {!activeCommunity ? (
            <div className="community-empty">Pick a community to view posts</div>
          ) : (
            <>
              {sessionCreateNotice ? (
                <div className="community-session-toast" role="status" aria-live="polite">
                  {sessionCreateNotice}
                </div>
              ) : null}
              {assignmentDeleteTarget ? (
                <div className="community-confirm-backdrop" role="presentation">
                  <div
                    className="community-confirm-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="assignment-delete-title"
                  >
                    <div className="community-confirm-kicker">Confirm action</div>
                    <h4 id="assignment-delete-title">Delete assignment?</h4>
                    <p>
                      {assignmentDeleteTarget.title
                        ? `“${assignmentDeleteTarget.title}” and all its submissions will be removed from this class.`
                        : "This assignment and all its submissions will be removed from this class."}
                    </p>
                    <div className="community-confirm-actions">
                      <button
                        type="button"
                        className="community-confirm-cancel"
                        onClick={() => setAssignmentDeleteTarget(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="community-confirm-danger"
                        onClick={confirmDeleteAssignment}
                      >
                        Delete assignment
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              {communitySuccessModal ? (
                <div className="community-confirm-backdrop" role="presentation">
                  <div
                    className="community-confirm-modal community-confirm-modal-success"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="community-success-title"
                  >
                    <div className="community-confirm-kicker">{communitySuccessModal.kicker || "All set"}</div>
                    <h4 id="community-success-title">{communitySuccessModal.title}</h4>
                    <p>{communitySuccessModal.message}</p>
                    <div className="community-confirm-actions">
                      <button
                        type="button"
                        className={
                          communitySuccessModal.tone === "warning"
                            ? "community-confirm-warning"
                            : "community-confirm-success"
                        }
                        onClick={() => setCommunitySuccessModal(null)}
                      >
                        {communitySuccessModal.buttonLabel || "Okay"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="community-hero">
                <div
                  className="community-banner"
                  style={
                    activeCommunity.banner_url
                      ? {
                          backgroundImage: `url(${activeCommunity.banner_url})`,
                          backgroundPosition: `center calc(50% + ${communityBannerOffset}px)`,
                          cursor: isAdjustingCommunityBanner ? "grab" : "default",
                        }
                      : undefined
                  }
                  onMouseDown={isAdjustingCommunityBanner ? startCommunityBannerDrag : undefined}
                  onMouseMove={isAdjustingCommunityBanner ? onCommunityBannerDrag : undefined}
                  onMouseUp={isAdjustingCommunityBanner ? stopCommunityBannerDrag : undefined}
                  onMouseLeave={isAdjustingCommunityBanner ? stopCommunityBannerDrag : undefined}
                  onTouchStart={isAdjustingCommunityBanner ? startCommunityBannerDrag : undefined}
                  onTouchMove={isAdjustingCommunityBanner ? onCommunityBannerDrag : undefined}
                  onTouchEnd={isAdjustingCommunityBanner ? stopCommunityBannerDrag : undefined}
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
                <button className={activeTab === "announcements" ? "active" : ""} onClick={() => setActiveTab("announcements")}>
                  <span>Announcements</span>
                  {announcementBadgeCount > 0 && (
                    <span className="tab-count-badge">{announcementBadgeCount}</span>
                  )}
                </button>
                <button className={activeTab === "attendance" ? "active" : ""} onClick={() => setActiveTab("attendance")}>Attendance</button>
                <button className={activeTab === "members" ? "active" : ""} onClick={() => setActiveTab("members")}>Members</button>
                <button className={activeTab === "assignments" ? "active" : ""} onClick={() => setActiveTab("assignments")}>Assignments</button>
                <button className={activeTab === "library" ? "active" : ""} onClick={() => setActiveTab("library")}>Library</button>
                {canManageCommunitySettings && (
                  <button className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>
                    <span>Settings</span>
                    {pendingRequestCount > 0 && (
                      <span className="tab-count-badge">{pendingRequestCount}</span>
                    )}
                  </button>
                )}
                <button className={activeTab === "about" ? "active" : ""} onClick={() => setActiveTab("about")}>About</button>
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
                            maxLength={POST_MAX_LENGTH}
                          />
                          <div className="community-create-actions">
                            <span>{postText.length}/{POST_MAX_LENGTH}</span>
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
                              <button onClick={submitCommunityPost} disabled={isSubmittingCommunityPost}>
                                {isSubmittingCommunityPost ? "Posting..." : "Post"}
                              </button>
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
                                mediaLayout="collage"
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
                    {Number(activeCommunity.is_member) === 1 && (
                      <button
                        className="community-join community-leave-about"
                        onClick={() =>
                          toggleJoin({
                            id: activeCommunity.id,
                            slug: activeCommunity.slug,
                            is_member: activeCommunity.is_member,
                            join_request_status: activeCommunity.join_request_status,
                          })
                        }
                      >
                        Leave Community
                      </button>
                    )}
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
                            {(memberBadgesById[Number(m.id)] || []).length > 0 && (
                              <div className="member-learning-badges">
                                <span
                                  className="member-learning-badge"
                                  title={memberBadgesById[Number(m.id)].join(" • ")}
                                >
                                  {memberBadgesById[Number(m.id)][0]}
                                </span>
                              </div>
                            )}
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
                {activeTab === "attendance" && (
                  <section className="community-settings-panel attendance-panel">
                    <div className="assignment-top-row attendance-top-row">
                      <h4>Class Register</h4>
                      {isAttendanceManager && (
                        <div className="attendance-actions">
                          <button onClick={saveAttendance} disabled={!selectedSessionId || isSelectedSessionClosed}>Save Register</button>
                          <button type="button" onClick={markAllPresent} disabled={!selectedSessionId || attendanceRows.length === 0 || isSelectedSessionClosed}>Mark All Present</button>
                          <button type="button" onClick={exportAttendanceCsv} disabled={!selectedSessionId}>Export CSV</button>
                          <button type="button" onClick={exportAttendancePdf} disabled={!selectedSessionId}>Export PDF</button>
                        </div>
                      )}
                    </div>
                    {isAttendanceManager && selectedSessionId && isSelectedSessionClosed && (
                      <div className="community-empty">This session has ended. Attendance is locked.</div>
                    )}

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
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSessionId(null);
                              setAttendanceRows([]);
                              setAttendanceDrafts({});
                            }}
                          >
                            Close Session
                          </button>
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
                                  disabled={!isAttendanceManager || isSelectedSessionClosed}
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
                    {isCommunityModerator && (
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
                              <div key={`my-att-mod-${row.session_id}`} className="attendance-history-row">
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
                      {isCommunityOwner && (
                        <div className="assignment-actions">
                          <button onClick={exportGradebookCsv}>Export Gradebook CSV</button>
                          <button onClick={exportGradebookPdf}>Export Gradebook PDF</button>
                        </div>
                      )}
                    </div>
                    <div className="community-insights-grid">
                      <div className="community-calendar-card">
                        <div className="community-calendar-head">
                          <strong>Assignment Calendar</strong>
                          <div className="community-calendar-nav">
                            <button
                              type="button"
                              onClick={() =>
                                setCalendarMonth(
                                  new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1)
                                )
                              }
                            >
                              ←
                            </button>
                            <span>
                              {calendarMonth.toLocaleDateString([], { month: "long", year: "numeric" })}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setCalendarMonth(
                                  new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1)
                                )
                              }
                            >
                              →
                            </button>
                          </div>
                        </div>
                        {timelineStartDay && (
                          <div className="calendar-timeline-pill">
                            {timelineStartDay === timelineEndDay
                              ? `Timeline: Day ${timelineStartDay}`
                              : `Timeline: Day ${timelineStartDay} → Day ${timelineEndDay}`}
                          </div>
                        )}
                        <div className="community-calendar-grid">
                          {["S", "M", "T", "W", "T", "F", "S"].map((d, idx) => (
                            <div key={`head-${idx}-${d}`} className="calendar-day-head">{d}</div>
                          ))}
                          {monthCells.map((day, idx) => (
                            <div
                              key={`day-${idx}`}
                              className={`calendar-day-cell ${day ? "" : "empty"} ${
                                day && isCurrentMonthView && day === nowDate.getDate() ? "today" : ""
                              } ${
                                day && timelineStartDay && timelineEndDay && day >= timelineStartDay && day <= timelineEndDay
                                  ? "in-range"
                                  : ""
                              } ${
                                day && timelineStartDay && day === timelineStartDay ? "range-start" : ""
                              } ${
                                day && timelineEndDay && day === timelineEndDay ? "range-end" : ""
                              }`}
                            >
                              {day ? (
                                <>
                                  <span>{day}</span>
                                  {calendarItemsByDay[day]?.length > 0 && (() => {
                                    const dayItems = calendarItemsByDay[day];
                                    const assignmentsForDay = dayItems.filter((it) => it.type === "assignment");
                                    const sessionsForDay = dayItems.filter((it) => it.type === "session");
                                    return (
                                      <div className="calendar-marker-stack">
                                        {assignmentsForDay.slice(0, 2).map((item) => {
                                          const meta = getAssignmentDeadlineMeta(item.when);
                                          return (
                                            <span key={`assign-${item.id}`} className={`calendar-deadline-chip ${meta.tone}`}>
                                              {meta.label}
                                            </span>
                                          );
                                        })}
                                        {sessionsForDay.length > 0 && (
                                          <span className="calendar-session-chip">S{sessionsForDay.length}</span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                  {calendarItemsByDay[day]?.length > 3 && (
                                    <div className="calendar-extra-count">
                                      +{calendarItemsByDay[day].length - 3}
                                    </div>
                                  )}
                                </>
                              ) : null}
                            </div>
                          ))}
                        </div>
                        <div className="community-calendar-upcoming">
                          {upcomingCalendarItems.length === 0 ? (
                            <span>No upcoming items.</span>
                          ) : (
                            upcomingCalendarItems.map((item) => (
                              <div key={`upcoming-${item.id}`} className="calendar-upcoming-row">
                                <span className={`calendar-pill ${item.type}`}>
                                  {item.type === "assignment" ? "Assignment" : "Session"}
                                </span>
                                <span>{item.title}</span>
                                <small>
                                  {formatSimpleDate(item.when)}
                                  {item.type === "assignment" ? ` • ${getAssignmentDeadlineMeta(item.when).label}` : ""}
                                </small>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                    </div>
                    {isCommunityOwner && (
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
                        <select
                          className="assignment-type-select"
                          value={assignmentType}
                          onChange={(e) => setAssignmentType(e.target.value)}
                        >
                          <option value="theory">Theory</option>
                          <option value="practical">Practical</option>
                        </select>
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
                          const practicalFiles = Array.isArray(submissionFiles[a.id]) ? submissionFiles[a.id] : [];
                          const isPractical = String(a.assignment_type || "theory").toLowerCase() === "practical";
                          const uploadedFilesCount = Array.isArray(a.viewer_submission_files)
                            ? a.viewer_submission_files.length
                            : (a.viewer_submission_attachment_url ? 1 : 0);
                          const viewerStatus = a.viewer_submission_status || "";
                          const pastDue = isAssignmentPastDue(a);
                          const attempts = Number(a.viewer_submission_attempts || 0);
                          const submissionLocked = isPractical ? false : attempts >= 2;
                          const gradedLocked = isPractical
                            ? false
                            : (
                                Boolean(a.viewer_submission_graded_at) ||
                                (a.viewer_submission_score !== null && a.viewer_submission_score !== undefined) ||
                                ["graded", "needs_revision", "missing"].includes(
                                  String(viewerStatus || "").toLowerCase()
                                )
                              );
                          return (
                            <div key={a.id} className={`assignment-row ${isCommunityMod ? "mod-view" : ""}`}>
                              <div className="member-name">{a.title}</div>
                              <div className="member-meta">
                                Due: {a.due_at ? new Date(a.due_at).toLocaleString() : "No due date"} • Points: {a.points} • Type: {String(a.assignment_type || "theory")}
                              </div>
                              {isCommunityOwner && a.due_at && !isAssignmentPastDue(a) && (
                                <div className="assignment-deadline-edit">
                                  <input
                                    type="datetime-local"
                                    value={deadlineEdits[a.id] ?? toDatetimeLocalValue(a.due_at)}
                                    onChange={(e) =>
                                      setDeadlineEdits((prev) => ({ ...prev, [a.id]: e.target.value }))
                                    }
                                  />
                                  <button
                                    type="button"
                                    onClick={() => extendAssignmentDeadline(a.id)}
                                  >
                                    Extend deadline
                                  </button>
                                </div>
                              )}
                              {isCommunityOwner && a.due_at && isAssignmentPastDue(a) && (
                                <div className="assignment-deadline-locked">
                                  Deadline elapsed. Extension locked.
                                </div>
                              )}
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
                                {isPractical
                                  ? (a.viewer_submitted_at
                                      ? ` • Last submitted: ${formatSubmissionRelativeTime(a.viewer_submitted_at)}`
                                      : " • No upload yet for this practical assignment")
                                  : (a.viewer_submission_status ? ` • Your status: ${a.viewer_submission_status}` : "")}
                                {a.viewer_submission_score !== null && a.viewer_submission_score !== undefined ? ` • Score: ${a.viewer_submission_score}` : ""}
                                {isPractical && uploadedFilesCount > 0 ? ` • Files uploaded: ${uploadedFilesCount}` : ""}
                                {!isPractical && attempts > 0 ? ` • Attempts: ${attempts}/2` : ""}
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
                              {Array.isArray(a.viewer_submission_files) && a.viewer_submission_files.length > 0 ? (
                                <div className="assignment-attachment">
                                  {a.viewer_submission_files.map((f, i) => (
                                    <div key={`my-sub-file-${a.id}-${i}`} className="community-file-chip">
                                      <a href={f.file_url} target="_blank" rel="noreferrer">
                                        📎 {f.file_name || `Uploaded file ${i + 1}`}
                                      </a>
                                      {isPractical && !pastDue && (
                                        <button
                                          type="button"
                                          onClick={() => deletePracticalSubmissionFile(a.id, f.id)}
                                          title="Delete file"
                                        >
                                          ×
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : a.viewer_submission_attachment_url ? (
                                <div className="assignment-attachment">
                                  <a href={a.viewer_submission_attachment_url} target="_blank" rel="noreferrer">
                                    📎 {a.viewer_submission_attachment_name || "Your uploaded file"}
                                  </a>
                                </div>
                              ) : null}
                              {!isCommunityOwner && Number(activeCommunity.is_member) === 1 && (
                                <>
                                  {!submissionLocked && !gradedLocked ? (
                                    <div className="assignment-submit-row">
                                      {!isPractical && (
                                        <textarea
                                          placeholder="Write your answer/submission"
                                          value={draftValue || persistedDraft}
                                          onChange={(e) => {
                                            touchVineActivity();
                                            setSubmissionDrafts((prev) => ({ ...prev, [a.id]: e.target.value }));
                                          }}
                                          disabled={pastDue}
                                        />
                                      )}
                                      {isPractical && (
                                        <label className="assignment-file-picker">
                                          <span>
                                            {practicalFiles.length > 0
                                              ? `${practicalFiles.length} file(s) selected`
                                              : "Upload PPT/XLS/DOC/Access/PUB/PDF"}
                                          </span>
                                          <input
                                            type="file"
                                            accept=".ppt,.pptx,.xls,.xlsx,.doc,.docx,.mdb,.accdb,.pub,.pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/x-msaccess,application/vnd.ms-access,application/vnd.ms-publisher,application/pdf"
                                            multiple
                                            onChange={(e) => {
                                              touchVineActivity();
                                              setSubmissionFiles((prev) => ({
                                                ...prev,
                                                [a.id]: Array.from(e.target.files || []),
                                              }));
                                            }}
                                            disabled={pastDue}
                                          />
                                        </label>
                                      )}
                                      {isPractical && practicalFiles.length > 0 && (
                                        <div className="community-files-list">
                                          {practicalFiles.map((f, i) => (
                                            <div key={`practical-file-${a.id}-${i}`} className="community-file-chip">
                                              <span>{f.name}</span>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  setSubmissionFiles((prev) => ({
                                                    ...prev,
                                                    [a.id]: practicalFiles.filter((_, idx) => idx !== i),
                                                  }))
                                                }
                                                title="Remove file"
                                              >
                                                ×
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      <div className="assignment-submit-actions">
                                        {!isPractical && (
                                          <button className="assignment-save-draft-btn" type="button" onClick={() => saveAssignmentDraft(a.id)} disabled={pastDue}>
                                            Save Draft
                                          </button>
                                        )}
                                        <button onClick={() => submitAssignment(a.id, a.assignment_type)} disabled={pastDue}>
                                          {isPractical ? "Submit" : (viewerStatus ? "Resubmit" : "Submit")}
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
                              {isCommunityOwner && (
                                <div className="assignment-mod-row">
                                  <button onClick={() => toggleAssignmentReview(a.id)}>
                                    {selectedAssignmentId === a.id ? "Hide submissions" : "Review submissions"}
                                  </button>
                                  {String(a.assignment_type || "theory").toLowerCase() === "theory" && (
                                    <button onClick={() => exportSubmittedWorkPdf(a)}>
                                      Submitted Work PDF
                                    </button>
                                  )}
                                  <button
                                    className="assignment-delete-btn"
                                    onClick={() => deleteAssignment(a)}
                                  >
                                    Delete assignment
                                  </button>
                                </div>
                              )}
                              {isCommunityOwner && selectedAssignmentId === a.id && (
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
                                      const submissionFilesCount = Array.isArray(s.submission_files)
                                        ? s.submission_files.length
                                        : (s.attachment_url ? 1 : 0);
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
                                              <div className="member-meta">
                                                @{s.username} • {new Date(s.submitted_at).toLocaleString()}
                                                {submissionFilesCount > 0 ? ` • Files: ${submissionFilesCount}` : ""}
                                              </div>
                                            </div>
                                          </div>
                                          <div className="assignment-body">{s.content || "No content"}</div>
                                          {Array.isArray(s.submission_files) && s.submission_files.length > 0 ? (
                                            <div className="assignment-attachment">
                                              {s.submission_files.map((f, i) => (
                                                <div key={`submission-file-${s.id}-${i}`}>
                                                  <a href={f.file_url} target="_blank" rel="noreferrer">
                                                    📎 {f.file_name || `Submitted file ${i + 1}`}
                                                  </a>
                                                </div>
                                              ))}
                                            </div>
                                          ) : s.attachment_url ? (
                                            <div className="assignment-attachment">
                                              <a href={s.attachment_url} target="_blank" rel="noreferrer">
                                                📎 {s.attachment_name || "Submitted file"}
                                              </a>
                                            </div>
                                          ) : null}
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
                                <div className="member-name">
                                  {row.display_name || row.username}
                                  {Number(row.is_verified) === 1 && (
                                    <span className="community-verified-badge" title="Verified">✓</span>
                                  )}
                                </div>
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
                {activeTab === "library" && (
                  <section className="community-settings-panel community-library-panel">
                    <div className="assignment-top-row">
                      <h4>Library</h4>
                    </div>
                    {isCommunityOwner && (
                      <div className="library-upload-row">
                        <input
                          type="text"
                          placeholder="PDF title"
                          value={libraryTitle}
                          maxLength={180}
                          onChange={(e) => setLibraryTitle(e.target.value)}
                        />
                        <label className="assignment-file-picker">
                          <span>{libraryFile ? libraryFile.name : "Choose PDF"}</span>
                          <input
                            ref={libraryFileInputRef}
                            type="file"
                            accept=".pdf,application/pdf"
                            onChange={(e) => setLibraryFile(e.target.files?.[0] || null)}
                          />
                        </label>
                        <button type="button" onClick={uploadLibraryPdf}>
                          Upload PDF
                        </button>
                      </div>
                    )}
                    <div className="library-grid">
                      {libraryItems.length === 0 ? (
                        <div className="community-empty">No PDFs in library yet.</div>
                      ) : (
                        libraryItems.map((item) => (
                          <div
                            key={`library-${item.id}`}
                            className="library-card"
                            role="button"
                            tabIndex={0}
                            onClick={() => window.open(item.pdf_url, "_blank", "noopener,noreferrer")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                window.open(item.pdf_url, "_blank", "noopener,noreferrer");
                              }
                            }}
                          >
                            <div className="library-thumb">
                              <object
                                data={`${item.pdf_url}#page=1&view=FitH`}
                                type="application/pdf"
                                className="library-thumb-preview"
                                aria-label={item.title}
                              >
                                <span>PDF</span>
                              </object>
                              <div className="library-thumb-overlay">PDF</div>
                            </div>
                            <div className="library-meta">
                              <strong>{item.title}</strong>
                              <small>
                                {item.uploader_display_name || item.uploader_username} •{" "}
                                {item.created_at ? new Date(item.created_at).toLocaleDateString() : ""}
                              </small>
                            </div>
                            {isCommunityOwner && (
                              <button
                                type="button"
                                className="library-remove-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteLibraryItem(item.id);
                                }}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                )}
                {activeTab === "announcements" && isCommunityOwner && (
                  <section className="community-announcements">
                    <div className="community-announcements-head">
                      <h4>Announcements</h4>
                    </div>
                    <div className="community-announcement-create">
                      <textarea
                        placeholder="Write announcement for members..."
                        value={announcementText}
                        onChange={(e) => setAnnouncementText(e.target.value)}
                        maxLength={POST_MAX_LENGTH}
                      />
                      <div className="community-announcement-create-actions">
                        <span>{announcementText.length}/{POST_MAX_LENGTH}</span>
                        <button
                          type="button"
                          onClick={createAnnouncement}
                          disabled={!announcementText.trim()}
                        >
                          Post Announcement
                        </button>
                      </div>
                    </div>
                    <div className="community-announcements-list">
                      {announcementPosts.length === 0 ? (
                        <div className="community-empty">No announcements yet.</div>
                      ) : (
                        announcementPosts.map((post) => {
                          const isSeen = Boolean(seenAnnouncementIds[post.id]);
                          return (
                            <div
                              key={`announcement-${post.id}`}
                              className={`community-announcement-row ${isSeen ? "seen" : "unseen"}`}
                              onClick={() => {
                                markAnnouncementRead(post.id);
                                navigate(`/vine/feed?post=${post.id}`);
                              }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  markAnnouncementRead(post.id);
                                  navigate(`/vine/feed?post=${post.id}`);
                                }
                              }}
                            >
                              <div className="community-announcement-main">
                                <strong>{post.display_name || post.username}</strong>
                                {Number(editingAnnouncementId) === Number(post.id) ? (
                                  <textarea
                                    value={editingAnnouncementText}
                                    onChange={(e) => setEditingAnnouncementText(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="announcement-edit-box"
                                    maxLength={POST_MAX_LENGTH}
                                  />
                                ) : (
                                  <span>{(post.content || "").trim().slice(0, 120) || "Pinned announcement"}</span>
                                )}
                              </div>
                              <div className="community-announcement-meta">
                                {!isSeen && <span className="announcement-new-dot">NEW</span>}
                                <small>{formatSimpleDate(post.created_at)}</small>
                                {Number(editingAnnouncementId) === Number(post.id) ? (
                                  <div className="announcement-owner-actions" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="announcement-edit-btn"
                                      onClick={async () => {
                                        const nextText = editingAnnouncementText.trim();
                                        if (!nextText) return;
                                        const res = await fetch(`${API}/api/vine/posts/${post.id}`, {
                                          method: "PATCH",
                                          headers: {
                                            "Content-Type": "application/json",
                                            Authorization: `Bearer ${token}`,
                                          },
                                          body: JSON.stringify({ content: nextText }),
                                        });
                                        if (!res.ok) {
                                          alert("Failed to edit announcement");
                                          return;
                                        }
                                        setEditingAnnouncementId(null);
                                        setEditingAnnouncementText("");
                                        await loadCommunityDetail(activeCommunity.slug, topicFilter);
                                      }}
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      className="announcement-unpin-btn"
                                      onClick={() => {
                                        setEditingAnnouncementId(null);
                                        setEditingAnnouncementText("");
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="announcement-owner-actions" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="announcement-edit-btn"
                                      onClick={() => {
                                        setEditingAnnouncementId(post.id);
                                        setEditingAnnouncementText(String(post.content || ""));
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="announcement-unpin-btn"
                                      onClick={async () => {
                                        const ok = window.confirm("Remove this announcement?");
                                        if (!ok) return;
                                        const res = await fetch(`${API}/api/vine/posts/${post.id}`, {
                                          method: "DELETE",
                                          headers: { Authorization: `Bearer ${token}` },
                                        });
                                        if (!res.ok) {
                                          alert("Failed to remove announcement");
                                          return;
                                        }
                                        await loadCommunityDetail(activeCommunity.slug, topicFilter);
                                      }}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>
                )}
                {activeTab === "announcements" && !isCommunityOwner && (
                  <section className="community-announcements">
                    <div className="community-announcements-head">
                      <h4>Announcements</h4>
                      {announcementBadgeCount > 0 && (
                        <span className="community-announcements-badge">{announcementBadgeCount} new</span>
                      )}
                    </div>
                    <div className="community-announcements-list">
                      {announcementPosts.length === 0 ? (
                        <div className="community-empty">No announcements yet.</div>
                      ) : (
                        announcementPosts.map((post) => {
                          const isSeen = Boolean(seenAnnouncementIds[post.id]);
                          return (
                            <div
                              key={`announcement-member-${post.id}`}
                              className={`community-announcement-row ${isSeen ? "seen" : "unseen"}`}
                              onClick={() => {
                                markAnnouncementRead(post.id);
                                navigate(`/vine/feed?post=${post.id}`);
                              }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  markAnnouncementRead(post.id);
                                  navigate(`/vine/feed?post=${post.id}`);
                                }
                              }}
                            >
                              <div className="community-announcement-main">
                                <strong>{post.display_name || post.username}</strong>
                                <span>{(post.content || "").trim().slice(0, 120) || "Pinned announcement"}</span>
                              </div>
                              <div className="community-announcement-meta">
                                {!isSeen && <span className="announcement-new-dot">NEW</span>}
                                <small>{formatSimpleDate(post.created_at)}</small>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>
                )}
                {activeTab === "announcements" && isCommunityMod && (
                  <section className="community-progress-card">
                    <strong>Progress Dashboard</strong>
                    <div className="community-progress-summary">
                      <div>
                        <span>Learners</span>
                        <b>{progressSummary.count}</b>
                      </div>
                      <div>
                        <span>Avg attendance</span>
                        <b>
                          {progressSummary.count
                            ? Math.round(progressSummary.avgAttendance / progressSummary.count)
                            : 0}
                          %
                        </b>
                      </div>
                      <div>
                        <span>Submission rate</span>
                        <b>
                          {progressSummary.count
                            ? Math.round(progressSummary.avgSubmission / progressSummary.count)
                            : 0}
                          %
                        </b>
                      </div>
                      <div>
                        <span>At risk</span>
                        <b>{progressSummary.atRisk}</b>
                      </div>
                    </div>
                    <div className="community-progress-table">
                      {(progressRows || []).map((row) => (
                        <div key={`progress-${row.learner_id}`} className="progress-row">
                          <div className="progress-user">
                            <img
                              src={row.learner_avatar_url ? (row.learner_avatar_url.startsWith("http") ? row.learner_avatar_url : `${API}${row.learner_avatar_url}`) : DEFAULT_AVATAR}
                              alt={row.learner_username}
                              onError={(e) => {
                                e.currentTarget.src = DEFAULT_AVATAR;
                              }}
                            />
                            <span>{row.learner_display_name || row.learner_username}</span>
                          </div>
                          <span>{row.attendance_rate}% attend</span>
                          <span>{row.submission_rate}% submit</span>
                          <span>{row.avg_score === null ? "-" : Number(row.avg_score).toFixed(1)}</span>
                          <span className={`risk-pill ${row.risk_flag}`}>{row.risk_flag}</span>
                        </div>
                      ))}
                      {(!progressRows || progressRows.length === 0) && (
                        <div className="community-empty">No progress data yet.</div>
                      )}
                    </div>
                  </section>
                )}
                {activeTab === "settings" && ["owner", "moderator"].includes(String(activeCommunity.viewer_role || "").toLowerCase()) && (
                  <section className="community-settings-panel">
                    <h4>{isCommunityOwner ? "Group Settings" : "Pending Join Requests"}</h4>
                    {isCommunityOwner && (
                      <>
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
                            <button
                              type="button"
                              className="community-banner-adjust-btn"
                              onClick={() => {
                                if (isAdjustingCommunityBanner) {
                                  stopCommunityBannerDrag();
                                } else {
                                  setIsAdjustingCommunityBanner(true);
                                }
                              }}
                            >
                              {isAdjustingCommunityBanner ? "Save Banner Position" : "Adjust Banner Position"}
                            </button>
                          </label>
                        </div>
                      </>
                    )}

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

                    {isCommunityOwner && (
                      <>
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
                      </>
                    )}
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
