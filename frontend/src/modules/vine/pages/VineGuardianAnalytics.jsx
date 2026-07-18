import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import { withCacheBust } from "../../../utils/cacheBust";
import {
  DEFAULT_ACTIVITY_GALLERY_IMAGES,
  DEFAULT_SITE_VISUALS,
  primeSiteVisualsCache,
} from "../../../utils/siteVisuals";
import { primeVineAuthThemeCache } from "../utils/authTheme";
import { convertHeicFileToJpeg, isHeicLikeFile } from "../utils/heic";
import "./VineGuardianAnalytics.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const ANALYTICS_REFRESH_MS = 3 * 60 * 1000;
const EMPTY_ANALYTICS_ROWS = [];
const NEWS_WEEKDAY_OPTIONS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];
const ACTIVITY_FILTER_OPTIONS = [
  ["all", "Everything"],
  ["logins", "Logins only"],
  ["posts", "Posts only"],
  ["comments", "Comments"],
  ["dms", "DMs only"],
  ["follows", "Follows"],
  ["communities", "Communities"],
];
const AUTH_THEME_EFFECT_OPTIONS = [
  ["clean", "Clean"],
  ["cinematic", "Cinematic"],
  ["floral", "Floral"],
  ["botanical", "Botanical"],
  ["dawn", "Dawn"],
  ["noir", "Noir"],
];
const AUTH_THEME_ALIGNMENT_OPTIONS = [
  ["left", "Left"],
  ["center", "Center"],
  ["right", "Right"],
];
const DEFAULT_AUTH_THEME_FORM = {
  cover_url: "/newactivities/fffffffffff.jpg",
  effect_preset: "clean",
  form_alignment: "right",
};
const DEFAULT_SITE_VISUAL_FORM = {
  home_hero_url: DEFAULT_SITE_VISUALS.home_hero_url,
  boarding_login_url: DEFAULT_SITE_VISUALS.boarding_login_url,
  ark_auth_slides: DEFAULT_SITE_VISUALS.ark_auth_slides,
  activities_banner_url: DEFAULT_SITE_VISUALS.activities_banner_url,
  contact_hero_url: DEFAULT_SITE_VISUALS.contact_hero_url,
  activities_gallery: DEFAULT_ACTIVITY_GALLERY_IMAGES,
  activities_latest_batch: DEFAULT_SITE_VISUALS.activities_latest_batch,
  activities_latest_day: DEFAULT_SITE_VISUALS.activities_latest_day,
  create_community_enabled: DEFAULT_SITE_VISUALS.create_community_enabled,
};
const SITE_VISUAL_NOTICE_DURATION_MS = 4500;
const SITE_VISUAL_NOTICE_LABELS = {
  "home-hero": "Homepage hero",
  "boarding-cover": "Boarding login cover",
  "activities-gallery": "Activities visuals",
  "ark-slides": "ARK auth slideshow",
  "contact-hero": "Contact hero",
  "community-create-toggle": "Community creation",
};

const getKampalaDateStamp = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const isGuardianUser = (user) => {
  if (!user) return false;
  if (Number(user.is_admin) === 1) return true;
  if (String(user.role || "").toLowerCase() === "moderator") return true;
  return ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
    String(user.username || "").toLowerCase()
  );
};

const hasSpecialVerifiedBadge = (user) =>
  ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
    String(user?.username || "").toLowerCase()
  ) || ["guardian", "news"].includes(String(user?.badge_type || "").toLowerCase());

const getActivityIcon = (type) =>
  ({
    post: "📝",
    comment: "💬",
    reply: "↩️",
    like: "❤️",
    revine: "🔁",
    follow: "➕",
    dm: "✉️",
    community_join: "👥",
    assignment_submit: "📚",
    login: "🔐",
  }[String(type || "").toLowerCase()] || "🌱");

const getActivityStateLabel = (row) => {
  if (row?.is_online_now) return "Online now";
  if (String(row?.session_state || "").toLowerCase() === "active") return "Active";
  if (String(row?.session_state || "").toLowerCase() === "ended") return "Ended";
  return "Expired";
};

const getInitials = (value) => {
  const text = String(value || "").trim();
  if (!text) return "V";
  const parts = text.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || text.slice(0, 2).toUpperCase();
};

const createLifecycleAnalyticsState = () => ({
  logins: null,
  loading: { logins: true },
  errors: {},
});

export default function VineGuardianAnalytics() {
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [activityLastFetchedAt, setActivityLastFetchedAt] = useState(null);
  const [activityFilter, setActivityFilter] = useState("all");
  const [newsForm, setNewsForm] = useState({
    allowed_weekdays: [],
    daily_hour: 12,
    daily_minute: 0,
    timezone: "Africa/Kampala",
  });
  const [newsSaving, setNewsSaving] = useState(false);
  const [newsRefreshing, setNewsRefreshing] = useState(false);
  const [noticeForm, setNoticeForm] = useState({
    enabled: true,
    title: "A quick Vine update",
    message:
      "We have polished a few things across Vine to keep it lighter, cleaner, and easier to use. Tap okay to continue.",
  });
  const [noticeSaving, setNoticeSaving] = useState(false);
  const [authThemeForm, setAuthThemeForm] = useState(DEFAULT_AUTH_THEME_FORM);
  const [authThemeCoverFile, setAuthThemeCoverFile] = useState(null);
  const [authThemeCoverPreview, setAuthThemeCoverPreview] = useState("");
  const [authThemeSaving, setAuthThemeSaving] = useState(false);
  const [authThemeNotice, setAuthThemeNotice] = useState(null);
  const [siteVisualForm, setSiteVisualForm] = useState(DEFAULT_SITE_VISUAL_FORM);
  const [siteHeroFile, setSiteHeroFile] = useState(null);
  const [siteHeroPreview, setSiteHeroPreview] = useState("");
  const [siteBoardingFile, setSiteBoardingFile] = useState(null);
  const [siteBoardingPreview, setSiteBoardingPreview] = useState("");
  const [siteActivitiesBannerFile, setSiteActivitiesBannerFile] = useState(null);
  const [siteActivitiesBannerPreview, setSiteActivitiesBannerPreview] = useState("");
  const [siteContactHeroFile, setSiteContactHeroFile] = useState(null);
  const [siteContactHeroPreview, setSiteContactHeroPreview] = useState("");
  const [siteSlideFiles, setSiteSlideFiles] = useState([]);
  const [siteActivitiesGalleryFiles, setSiteActivitiesGalleryFiles] = useState([]);
  const [draggedActivityIndex, setDraggedActivityIndex] = useState(null);
  const [dragOverActivityIndex, setDragOverActivityIndex] = useState(null);
  const [siteVisualSaving, setSiteVisualSaving] = useState(false);
  const [siteVisualSavingTarget, setSiteVisualSavingTarget] = useState("");
  const [siteVisualNotice, setSiteVisualNotice] = useState(null);
  const [lifecycleAnalytics, setLifecycleAnalytics] = useState(createLifecycleAnalyticsState);
  const [from, setFrom] = useState(() => {
    const d = new Date(Date.now() - 6 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("vine_user") || "{}");
    } catch {
      return {};
    }
  }, []);

  useEffect(() => {
    document.title = "Vine Guardian Analytics";
  }, []);

  useEffect(() => {
    if (!token || !isGuardianUser(currentUser)) {
      navigate("/vine/feed");
      return;
    }

    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const q = new URLSearchParams({ from, to }).toString();
        const [
          overviewResult,
          activityResult,
          newsHealthResult,
          newsSettingsResult,
          noticeSettingsResult,
          authThemeSettingsResult,
          siteVisualSettingsResult,
        ] =
          await Promise.allSettled([
          fetch(`${API}/api/vine/analytics/overview?${q}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/analytics/activity`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/news/health`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/news/settings`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/system-notice/settings`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/auth-theme/settings`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          fetch(`${API}/api/vine/site-visuals/settings`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
        ]);

        if (overviewResult.status !== "fulfilled") {
          setError("Failed to load analytics");
          return;
        }

        const overviewRes = overviewResult.value;
        const overviewBody = await overviewRes.json();
        if (!overviewRes.ok) {
          setError(overviewBody?.message || "Failed to load analytics");
          return;
        }

        let activityBody = null;
        if (activityResult.status === "fulfilled") {
          const activityRes = activityResult.value;
          const parsed = await activityRes.json().catch(() => null);
          if (activityRes.ok) {
            activityBody = parsed;
            setActivityLastFetchedAt(new Date().toISOString());
          }
        }

        let newsHealthBody = null;
        if (newsHealthResult?.status === "fulfilled") {
          const newsHealthRes = newsHealthResult.value;
          const parsed = await newsHealthRes.json().catch(() => null);
          if (newsHealthRes.ok) {
            newsHealthBody = parsed;
          }
        }

        let newsSettingsBody = null;
        if (newsSettingsResult?.status === "fulfilled") {
          const newsSettingsRes = newsSettingsResult.value;
          const parsed = await newsSettingsRes.json().catch(() => null);
          if (newsSettingsRes.ok) {
            newsSettingsBody = parsed;
          }
        }

        let noticeSettingsBody = null;
        if (noticeSettingsResult?.status === "fulfilled") {
          const noticeSettingsRes = noticeSettingsResult.value;
          const parsed = await noticeSettingsRes.json().catch(() => null);
          if (noticeSettingsRes.ok) {
            noticeSettingsBody = parsed;
          }
        }

        let authThemeSettingsBody = null;
        if (authThemeSettingsResult?.status === "fulfilled") {
          const authThemeSettingsRes = authThemeSettingsResult.value;
          const parsed = await authThemeSettingsRes.json().catch(() => null);
          if (authThemeSettingsRes.ok) {
            authThemeSettingsBody = parsed;
          }
        }

        let siteVisualSettingsBody = null;
        if (siteVisualSettingsResult?.status === "fulfilled") {
          const siteVisualSettingsRes = siteVisualSettingsResult.value;
          const parsed = await siteVisualSettingsRes.json().catch(() => null);
          if (siteVisualSettingsRes.ok) {
            siteVisualSettingsBody = parsed;
          }
        }

        setData({
          ...overviewBody,
          activity: activityBody,
          newsHealth: newsHealthBody,
          newsSettings: newsSettingsBody,
          noticeSettings: noticeSettingsBody,
          authThemeSettings: authThemeSettingsBody,
          siteVisualSettings: siteVisualSettingsBody,
        });
      } catch {
        setError("Failed to load analytics");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token, currentUser, navigate, from, to]);

  useEffect(() => {
    if (!token || !isGuardianUser(currentUser)) {
      return undefined;
    }

    let intervalId = null;

    const refreshAnalyticsPanels = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const [activityRes, newsHealthRes] = await Promise.allSettled([
          fetch(`${API}/api/vine/analytics/activity`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/news/health`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        const nextData = {};

        if (activityRes.status === "fulfilled") {
          const parsed = await activityRes.value.json().catch(() => null);
          if (activityRes.value.ok && parsed) {
            nextData.activity = parsed;
            setActivityLastFetchedAt(new Date().toISOString());
          }
        }

        if (newsHealthRes.status === "fulfilled") {
          const parsed = await newsHealthRes.value.json().catch(() => null);
          if (newsHealthRes.value.ok && parsed) {
            nextData.newsHealth = parsed;
          }
        }

        if (Object.keys(nextData).length) {
          setData((prev) => (prev ? { ...prev, ...nextData } : prev));
        }
      } catch {
        // Keep the last successful snapshot; auto-refresh should stay quiet.
      }
    };

    const startInterval = () => {
      if (intervalId) return;
      intervalId = window.setInterval(refreshAnalyticsPanels, ANALYTICS_REFRESH_MS);
    };

    const stopInterval = () => {
      if (!intervalId) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshAnalyticsPanels();
        startInterval();
      } else {
        stopInterval();
      }
    };

    if (document.visibilityState === "visible") {
      startInterval();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [token, currentUser]);

  useEffect(() => {
    if (!token || !isGuardianUser(currentUser)) {
      return undefined;
    }

    let cancelled = false;
    const query = new URLSearchParams({ from, to }).toString();

    const loadLoginAnalytics = async () => {
      setLifecycleAnalytics(createLifecycleAnalyticsState());
      const response = await fetch(`${API}/api/vine/analytics/login-frequency?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => null);

      if (cancelled) return;
      const nextState = createLifecycleAnalyticsState();
      nextState.loading.logins = false;
      if (!response.ok) {
        nextState.errors.logins = body?.message || "Unavailable";
      } else {
        nextState.logins = body;
      }
      setLifecycleAnalytics(nextState);
    };

    loadLoginAnalytics().catch(() => {
      if (cancelled) return;
      setLifecycleAnalytics((prev) => ({
        ...prev,
        loading: { logins: false },
        errors: { logins: "Failed to load login analytics" },
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [token, currentUser, from, to]);

  useEffect(() => {
    const source = data?.newsSettings || data?.newsHealth?.runtime;
    if (!source) return;
    setNewsForm({
      allowed_weekdays: Array.isArray(source.allowed_weekdays)
        ? source.allowed_weekdays.map((value) => Number(value)).filter((value) => Number.isInteger(value))
        : [],
      daily_hour: Number(source.daily_hour ?? 12),
      daily_minute: Number(source.daily_minute ?? 0),
      timezone: String(source.timezone || "Africa/Kampala"),
    });
  }, [data?.newsSettings, data?.newsHealth]);

  useEffect(() => {
    const source = data?.noticeSettings;
    if (!source) return;
    setNoticeForm({
      enabled: source.enabled !== false && Number(source.enabled) !== 0,
      title: String(source.title || "A quick Vine update"),
      message: String(
        source.message ||
          "We have polished a few things across Vine to keep it lighter, cleaner, and easier to use. Tap okay to continue."
      ),
    });
  }, [data?.noticeSettings]);

  useEffect(() => {
    const source = data?.authThemeSettings;
    if (!source) return;
    setAuthThemeForm({
      cover_url: String(source.cover_url || "/newactivities/fffffffffff.jpg"),
      effect_preset: ["clean", "cinematic", "floral", "botanical", "dawn", "noir"].includes(String(source.effect_preset || "").toLowerCase())
        ? String(source.effect_preset || "").toLowerCase()
        : "clean",
      form_alignment: ["left", "center", "right"].includes(String(source.form_alignment || "").toLowerCase())
        ? String(source.form_alignment || "").toLowerCase()
        : "right",
    });
  }, [data?.authThemeSettings]);

  useEffect(() => {
    const source = data?.siteVisualSettings;
    if (!source) return;
    setSiteVisualForm({
      home_hero_url: String(source.home_hero_url || DEFAULT_SITE_VISUAL_FORM.home_hero_url),
      boarding_login_url: String(source.boarding_login_url || DEFAULT_SITE_VISUAL_FORM.boarding_login_url),
      ark_auth_slides: Array.isArray(source.ark_auth_slides) && source.ark_auth_slides.length
        ? source.ark_auth_slides.map((item) => String(item || "").trim()).filter(Boolean)
        : DEFAULT_SITE_VISUAL_FORM.ark_auth_slides,
      activities_banner_url:
        String(source.activities_banner_url || DEFAULT_SITE_VISUAL_FORM.activities_banner_url).trim() ||
        DEFAULT_SITE_VISUAL_FORM.activities_banner_url,
      contact_hero_url:
        String(source.contact_hero_url || DEFAULT_SITE_VISUAL_FORM.contact_hero_url).trim() ||
        DEFAULT_SITE_VISUAL_FORM.contact_hero_url,
      activities_gallery:
        Array.isArray(source.activities_gallery) && source.activities_gallery.length
          ? source.activities_gallery.map((item) => String(item || "").trim()).filter(Boolean)
          : DEFAULT_SITE_VISUAL_FORM.activities_gallery,
      activities_latest_batch:
        Array.isArray(source.activities_latest_batch) && source.activities_latest_batch.length
          ? source.activities_latest_batch.map((item) => String(item || "").trim()).filter(Boolean)
          : DEFAULT_SITE_VISUAL_FORM.activities_latest_batch,
      activities_latest_day:
        String(source.activities_latest_day || DEFAULT_SITE_VISUAL_FORM.activities_latest_day || "").trim() || null,
      create_community_enabled:
        source.create_community_enabled === undefined || source.create_community_enabled === null
          ? true
          : Number(source.create_community_enabled) === 1 || source.create_community_enabled === true,
    });
  }, [data?.siteVisualSettings]);

  useEffect(() => {
    if (!authThemeCoverFile) {
      setAuthThemeCoverPreview("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(authThemeCoverFile);
    setAuthThemeCoverPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [authThemeCoverFile]);

  useEffect(() => {
    if (!siteHeroFile) {
      setSiteHeroPreview("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(siteHeroFile);
    setSiteHeroPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [siteHeroFile]);

  useEffect(() => {
    if (!siteBoardingFile) {
      setSiteBoardingPreview("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(siteBoardingFile);
    setSiteBoardingPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [siteBoardingFile]);

  useEffect(() => {
    if (!siteActivitiesBannerFile) {
      setSiteActivitiesBannerPreview("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(siteActivitiesBannerFile);
    setSiteActivitiesBannerPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [siteActivitiesBannerFile]);

  useEffect(() => {
    if (!siteContactHeroFile) {
      setSiteContactHeroPreview("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(siteContactHeroFile);
    setSiteContactHeroPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [siteContactHeroFile]);

  useEffect(() => {
    if (!authThemeNotice) return undefined;
    const timer = window.setTimeout(() => {
      setAuthThemeNotice(null);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [authThemeNotice]);

  useEffect(() => {
    if (!siteVisualNotice) return undefined;
    const timer = window.setTimeout(() => {
      setSiteVisualNotice(null);
    }, SITE_VISUAL_NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [siteVisualNotice]);

  const exportCsv = (filename, rows) => {
    if (!rows?.length) return;
    const keys = Object.keys(rows[0]);
    const esc = (val) => {
      const s = String(val ?? "");
      if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
        return `"${s.replaceAll("\"", "\"\"")}"`;
      }
      return s;
    };
    const csv = [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportActivityPdf = async ({
    mode = "current",
    recentLogins = [],
    filteredRecentActions = [],
    activityFilter = "all",
  } = {}) => {
    const activeFilterLabel =
      ACTIVITY_FILTER_OPTIONS.find(([value]) => value === activityFilter)?.[1] || "Everything";
    const exportingLogins = mode === "logins" || activityFilter === "logins";
    const rows = exportingLogins ? recentLogins : filteredRecentActions;

    if (!rows?.length) {
      alert(`No ${exportingLogins ? "login" : "activity"} rows to export right now.`);
      return;
    }

    try {
      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF("l", "mm", "a4");
      const title = exportingLogins
        ? "SPESS Vine - Guardian Login Log"
        : `SPESS Vine - Guardian Activity Log (${activeFilterLabel})`;
      const generatedAt = new Date().toLocaleString("en-UG", {
        dateStyle: "medium",
        timeStyle: "short",
      });

      doc.setFont("helvetica", "bold");
      doc.setTextColor(6, 78, 59);
      doc.setFontSize(18);
      doc.text(title, 14, 16);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(71, 85, 105);
      doc.setFontSize(10);
      doc.text(`Generated ${generatedAt}`, 14, 23);
      doc.text("Guardian network watch export", 14, 29);

      if (exportingLogins) {
        autoTable(doc, {
          startY: 34,
          head: [[
            "Display Name",
            "Username",
            "Login Time",
            "Last Seen",
            "Device",
            "Actions Since Login",
            "Last 3 Actions",
            "State",
          ]],
          body: rows.map((row) => [
            row.display_name || row.username || "",
            `@${row.username || ""}`,
            row.login_at ? formatAgo(row.login_at) : "—",
            row.last_seen_at ? (row.is_online_now ? "Online now" : formatAgo(row.last_seen_at)) : "—",
            row.device_label || "Unknown device",
            String(row.actions_since_login || 0),
            Array.isArray(row.recent_actions_preview) && row.recent_actions_preview.length
              ? row.recent_actions_preview
                  .map((activity) =>
                    `${getActivityIcon(activity.action_type)} ${activity.action_label}${activity.target_label ? ` • ${activity.target_label}` : ""}`
                  )
                  .join(" | ")
              : "No action after login yet",
            getActivityStateLabel(row),
          ]),
          styles: {
            fontSize: 8.4,
            cellPadding: 2.5,
            valign: "top",
            lineColor: [220, 252, 231],
          },
          headStyles: {
            fillColor: [6, 78, 59],
            textColor: [255, 255, 255],
            fontStyle: "bold",
          },
          alternateRowStyles: {
            fillColor: [240, 253, 244],
          },
          columnStyles: {
            0: { cellWidth: 36 },
            1: { cellWidth: 28 },
            2: { cellWidth: 24 },
            3: { cellWidth: 24 },
            4: { cellWidth: 34 },
            5: { cellWidth: 18, halign: "center" },
            6: { cellWidth: 95 },
            7: { cellWidth: 18, halign: "center" },
          },
          margin: { left: 10, right: 10 },
        });
      } else {
        autoTable(doc, {
          startY: 34,
          head: [[
            "Display Name",
            "Username",
            "Action",
            "Target",
            "Detail",
            "When",
            "State",
          ]],
          body: rows.map((row) => [
            row.display_name || row.username || "",
            `@${row.username || ""}`,
            `${getActivityIcon(row.action_type)} ${row.action_label || ""}`,
            row.target_label || "Vine",
            row.detail || "—",
            row.created_at ? formatAgo(row.created_at) : "—",
            row.is_online_now ? "Live" : "Seen",
          ]),
          styles: {
            fontSize: 8.6,
            cellPadding: 2.6,
            valign: "top",
            lineColor: [220, 252, 231],
          },
          headStyles: {
            fillColor: [6, 78, 59],
            textColor: [255, 255, 255],
            fontStyle: "bold",
          },
          alternateRowStyles: {
            fillColor: [240, 253, 244],
          },
          columnStyles: {
            0: { cellWidth: 34 },
            1: { cellWidth: 28 },
            2: { cellWidth: 46 },
            3: { cellWidth: 40 },
            4: { cellWidth: 86 },
            5: { cellWidth: 22, halign: "center" },
            6: { cellWidth: 20, halign: "center" },
          },
          margin: { left: 10, right: 10 },
        });
      }

      const filename = exportingLogins
        ? "guardian_recent_logins.pdf"
        : `guardian_${String(activityFilter || "all").replace(/[^a-z0-9_-]/gi, "_")}_activity.pdf`;
      doc.save(filename);
    } catch (err) {
      console.error("Guardian activity PDF export failed", err);
      alert("Failed to export PDF");
    }
  };

  const formatAgo = (value) => {
    if (!value) return "—";
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts)) return "—";
    const diffMs = Math.max(0, Date.now() - ts);
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatCount = (value) => Number(value || 0).toLocaleString("en-UG");

  const formatTimeOfDay = (hour, minute) =>
    `${String(Number(hour || 0)).padStart(2, "0")}:${String(Number(minute || 0)).padStart(2, "0")}`;

  const toggleNewsWeekday = (weekday) => {
    setNewsForm((prev) => {
      const current = new Set((prev.allowed_weekdays || []).map((value) => Number(value)));
      if (current.has(weekday)) current.delete(weekday);
      else current.add(weekday);
      return { ...prev, allowed_weekdays: Array.from(current).sort((a, b) => a - b) };
    });
  };

  const saveNewsSchedule = async () => {
    try {
      setNewsSaving(true);
      const res = await fetch(`${API}/api/vine/news/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newsForm),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body?.message || "Failed to save Vine News schedule");
        return;
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              newsSettings: body.settings,
              newsHealth: prev.newsHealth
                ? {
                    ...prev.newsHealth,
                    runtime: {
                      ...(prev.newsHealth.runtime || {}),
                      ...body.settings,
                    },
                  }
                : prev.newsHealth,
            }
          : prev
      );
      alert("Vine News schedule updated");
    } catch {
      alert("Failed to save Vine News schedule");
    } finally {
      setNewsSaving(false);
    }
  };

  const refreshNewsNow = async () => {
    try {
      setNewsRefreshing(true);
      const res = await fetch(`${API}/api/vine/news/refresh`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body?.message || "Failed to refresh Vine News");
        return;
      }
      const healthRes = await fetch(`${API}/api/vine/news/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const healthBody = await healthRes.json().catch(() => null);
      if (healthRes.ok && healthBody) {
        setData((prev) => (prev ? { ...prev, newsHealth: healthBody } : prev));
      }
      alert("Vine News refreshed");
    } catch {
      alert("Failed to refresh Vine News");
    } finally {
      setNewsRefreshing(false);
    }
  };

  const saveSystemNotice = async () => {
    try {
      setNoticeSaving(true);
      const res = await fetch(`${API}/api/vine/system-notice/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(noticeForm),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body?.message || "Failed to save login notice");
        return;
      }
      setData((prev) => (prev ? { ...prev, noticeSettings: body.settings } : prev));
      alert(body?.settings?.enabled ? "Login notice published" : "Login notice turned off");
    } catch {
      alert("Failed to save login notice");
    } finally {
      setNoticeSaving(false);
    }
  };

  const saveAuthTheme = async () => {
    try {
      setAuthThemeSaving(true);
      setAuthThemeNotice(null);
      let nextCoverUrl = authThemeForm.cover_url;

      if (authThemeCoverFile) {
        const formData = new FormData();
        formData.append("cover", authThemeCoverFile);
        const uploadRes = await fetch(`${API}/api/vine/auth-theme/cover`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });
        const uploadBody = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          setAuthThemeNotice({
            kind: "error",
            message: uploadBody?.message || "Failed to upload auth cover.",
          });
          return;
        }
        nextCoverUrl = String(uploadBody?.settings?.cover_url || nextCoverUrl || "").trim();
      }

      const res = await fetch(`${API}/api/vine/auth-theme/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          cover_url: nextCoverUrl,
          effect_preset: authThemeForm.effect_preset,
          form_alignment: authThemeForm.form_alignment,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuthThemeNotice({
          kind: "error",
          message: body?.message || "Failed to save auth theme.",
        });
        return;
      }

      const nextSettings = primeVineAuthThemeCache(body.settings || {});
      setData((prev) => (prev ? { ...prev, authThemeSettings: nextSettings } : prev));
      setAuthThemeCoverFile(null);
      setAuthThemeNotice({
        kind: "success",
        message: "Auth theme published.",
      });
    } catch {
      setAuthThemeNotice({
        kind: "error",
        message: "Failed to save auth theme.",
      });
    } finally {
      setAuthThemeSaving(false);
    }
  };

  const resetAuthTheme = async () => {
    try {
      setAuthThemeSaving(true);
      setAuthThemeNotice(null);
      const res = await fetch(`${API}/api/vine/auth-theme/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(DEFAULT_AUTH_THEME_FORM),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuthThemeNotice({
          kind: "error",
          message: body?.message || "Failed to reset auth theme.",
        });
        return;
      }
      const nextSettings = primeVineAuthThemeCache(body.settings || {});
      setData((prev) => (prev ? { ...prev, authThemeSettings: nextSettings } : prev));
      setAuthThemeForm(DEFAULT_AUTH_THEME_FORM);
      setAuthThemeCoverFile(null);
      setAuthThemeNotice({
        kind: "success",
        message: "Auth theme reset to default.",
      });
    } catch {
      setAuthThemeNotice({
        kind: "error",
        message: "Failed to reset auth theme.",
      });
    } finally {
      setAuthThemeSaving(false);
    }
  };

  const removeArkAuthSlide = (targetUrl) => {
    setSiteVisualForm((prev) => ({
      ...prev,
      ark_auth_slides: (prev.ark_auth_slides || []).filter((url) => url !== targetUrl),
    }));
  };

  const removeActivitiesImage = (targetUrl) => {
    const previousForm = siteVisualForm;
    const nextGallery = (siteVisualForm.activities_gallery || []).filter((url) => url !== targetUrl);
    const nextLatestBatch = (siteVisualForm.activities_latest_batch || []).filter((url) => url !== targetUrl);

    if (!nextGallery.length) {
      showSiteVisualNotice("activities-gallery", "error", "Please keep at least one Activities image.");
      return;
    }

    setSiteVisualForm((prev) => ({
      ...prev,
      activities_gallery: nextGallery,
      activities_latest_batch: nextLatestBatch,
    }));

    const persistRemoval = async () => {
      try {
        setSiteVisualSaving(true);
        setSiteVisualSavingTarget("activities-gallery-remove");
        setSiteVisualNotice(null);

        const res = await fetch(`${API}/api/vine/site-visuals/settings`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            home_hero_url: siteVisualSettings?.home_hero_url || siteVisualForm.home_hero_url,
            boarding_login_url: siteVisualSettings?.boarding_login_url || siteVisualForm.boarding_login_url,
            ark_auth_slides: siteVisualSettings?.ark_auth_slides || siteVisualForm.ark_auth_slides,
            activities_banner_url:
              siteVisualSettings?.activities_banner_url || siteVisualForm.activities_banner_url,
            contact_hero_url: siteVisualSettings?.contact_hero_url || siteVisualForm.contact_hero_url,
            activities_gallery: nextGallery,
            activities_latest_batch: nextLatestBatch,
            activities_latest_day:
              siteVisualForm.activities_latest_day || siteVisualSettings?.activities_latest_day || null,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSiteVisualForm(previousForm);
          showSiteVisualNotice(
            "activities-gallery",
            "error",
            body?.message || "Failed to remove Activities image."
          );
          return;
        }

        const nextSettings = primeSiteVisualsCache(body.settings || {});
        setData((prev) => (prev ? { ...prev, siteVisualSettings: nextSettings } : prev));
        showSiteVisualNotice("activities-gallery", "success", "Gallery image removed and published.");
      } catch {
        setSiteVisualForm(previousForm);
        showSiteVisualNotice("activities-gallery", "error", "Failed to remove Activities image.");
      } finally {
        setSiteVisualSaving(false);
        setSiteVisualSavingTarget("");
      }
    };

    void persistRemoval();
  };

  const reorderActivitiesImage = (fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    setSiteVisualForm((prev) => {
      const nextGallery = [...(prev.activities_gallery || [])];
      if (
        fromIndex >= nextGallery.length ||
        toIndex >= nextGallery.length
      ) {
        return prev;
      }
      const [moved] = nextGallery.splice(fromIndex, 1);
      nextGallery.splice(toIndex, 0, moved);
      return {
        ...prev,
        activities_gallery: nextGallery,
      };
    });
  };

  const normalizeVisualFile = async (file, label) => {
    if (!file) return null;
    if (!isHeicLikeFile(file)) return file;
    try {
      const converted = await convertHeicFileToJpeg(file);
      if (converted) return converted;
    } catch (err) {
      console.warn(`${label} HEIC conversion failed`, err);
    }
    setSiteVisualNotice({
      kind: "error",
      message: `${label} HEIC image could not be prepared. Please try JPG, PNG, or WebP.`,
    });
    return null;
  };

  const handleSiteHeroPick = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) {
      setSiteHeroFile(null);
      return;
    }
    const normalized = await normalizeVisualFile(file, "Homepage");
    if (!normalized) return;
    setSiteHeroFile(normalized);
  };

  const handleBoardingPick = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) {
      setSiteBoardingFile(null);
      return;
    }
    const normalized = await normalizeVisualFile(file, "Boarding");
    if (!normalized) return;
    setSiteBoardingFile(normalized);
  };

  const handleActivitiesBannerPick = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) {
      setSiteActivitiesBannerFile(null);
      return;
    }
    const normalized = await normalizeVisualFile(file, "Activities banner");
    if (!normalized) return;
    setSiteActivitiesBannerFile(normalized);
  };

  const handleContactHeroPick = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) {
      setSiteContactHeroFile(null);
      return;
    }
    const normalized = await normalizeVisualFile(file, "Contact hero");
    if (!normalized) return;
    setSiteContactHeroFile(normalized);
  };

  const handleSiteSlidesPick = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) {
      setSiteSlideFiles([]);
      return;
    }
    const normalizedFiles = [];
    for (const file of files) {
      const normalized = await normalizeVisualFile(file, "ARK auth slide");
      if (!normalized) return;
      normalizedFiles.push(normalized);
    }
    setSiteSlideFiles(normalizedFiles);
  };

  const handleActivitiesGalleryPick = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) {
      setSiteActivitiesGalleryFiles([]);
      return;
    }
    const normalizedFiles = [];
    for (const file of files) {
      const normalized = await normalizeVisualFile(file, "Activities image");
      if (!normalized) return;
      normalizedFiles.push(normalized);
    }
    setSiteActivitiesGalleryFiles(normalizedFiles);
  };

  const showSiteVisualNotice = (target, kind, message) => {
    setSiteVisualNotice({
      target,
      kind,
      message,
      shownAt: Date.now(),
      durationMs: SITE_VISUAL_NOTICE_DURATION_MS,
    });
  };

  const saveCommunityCreateToggle = async (enabled) => {
    const previousValue = Boolean(siteVisualForm.create_community_enabled);
    setSiteVisualForm((prev) => ({ ...prev, create_community_enabled: enabled }));
    try {
      setSiteVisualSaving(true);
      setSiteVisualSavingTarget("community-create-toggle");
      setSiteVisualNotice(null);
      const res = await fetch(`${API}/api/vine/site-visuals/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          home_hero_url: siteVisualForm.home_hero_url,
          boarding_login_url: siteVisualForm.boarding_login_url,
          ark_auth_slides: siteVisualForm.ark_auth_slides,
          activities_banner_url: siteVisualForm.activities_banner_url,
          contact_hero_url: siteVisualForm.contact_hero_url,
          activities_gallery: siteVisualForm.activities_gallery,
          activities_latest_batch: siteVisualForm.activities_latest_batch,
          activities_latest_day: siteVisualForm.activities_latest_day,
          create_community_enabled: enabled,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSiteVisualForm((prev) => ({ ...prev, create_community_enabled: previousValue }));
        showSiteVisualNotice("community-create-toggle", "error", body?.message || "Failed to update community create control.");
        return;
      }
      const nextSettings = primeSiteVisualsCache(body.settings || {});
      setData((prev) => (prev ? { ...prev, siteVisualSettings: nextSettings } : prev));
      showSiteVisualNotice(
        "community-create-toggle",
        "success",
        enabled ? "Create Community button is visible again." : "Create Community button is hidden from Communities."
      );
    } catch {
      setSiteVisualForm((prev) => ({ ...prev, create_community_enabled: previousValue }));
      showSiteVisualNotice("community-create-toggle", "error", "Failed to update community create control.");
    } finally {
      setSiteVisualSaving(false);
      setSiteVisualSavingTarget("");
    }
  };

  const saveSiteVisuals = async (target = "site-visuals") => {
    try {
      setSiteVisualSaving(true);
      setSiteVisualSavingTarget(target);
      setSiteVisualNotice(null);
      let nextHomeHeroUrl = siteVisualForm.home_hero_url;
      let nextBoardingLoginUrl = siteVisualForm.boarding_login_url;
      let nextArkSlides = [...(siteVisualForm.ark_auth_slides || [])];
      let nextActivitiesBannerUrl = siteVisualForm.activities_banner_url;
      let nextContactHeroUrl = siteVisualForm.contact_hero_url;
      let nextActivitiesGallery = [...(siteVisualForm.activities_gallery || [])];
      let nextActivitiesLatestBatch = [...(siteVisualForm.activities_latest_batch || [])];
      let nextActivitiesLatestDay = siteVisualForm.activities_latest_day || null;

      if (siteHeroFile) {
        const formData = new FormData();
        formData.append("hero", siteHeroFile);
        const uploadRes = await fetch(`${API}/api/vine/site-visuals/home-hero`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });
        const uploadBody = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          showSiteVisualNotice("home-hero", "error", uploadBody?.message || "Failed to upload homepage hero.");
          return;
        }
        nextHomeHeroUrl = String(uploadBody?.url || nextHomeHeroUrl || "").trim();
      }

      if (siteBoardingFile) {
        const formData = new FormData();
        formData.append("boarding", siteBoardingFile);
        const uploadRes = await fetch(`${API}/api/vine/site-visuals/boarding-login`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });
        const uploadBody = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          showSiteVisualNotice("boarding-cover", "error", uploadBody?.message || "Failed to upload Boarding login image.");
          return;
        }
        nextBoardingLoginUrl = String(uploadBody?.url || nextBoardingLoginUrl || "").trim();
      }

      if (siteActivitiesBannerFile) {
        const formData = new FormData();
        formData.append("banner", siteActivitiesBannerFile);
        const uploadRes = await fetch(`${API}/api/vine/site-visuals/activities-banner`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });
        const uploadBody = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          showSiteVisualNotice("activities-gallery", "error", uploadBody?.message || "Failed to upload Activities banner.");
          return;
        }
        nextActivitiesBannerUrl = String(uploadBody?.url || nextActivitiesBannerUrl || "").trim();
      }

      if (siteContactHeroFile) {
        const formData = new FormData();
        formData.append("contact", siteContactHeroFile);
        const uploadRes = await fetch(`${API}/api/vine/site-visuals/contact-hero`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });
        const uploadBody = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          showSiteVisualNotice("contact-hero", "error", uploadBody?.message || "Failed to upload Contact hero.");
          return;
        }
        nextContactHeroUrl = String(uploadBody?.url || nextContactHeroUrl || "").trim();
      }

      if (siteSlideFiles.length) {
        const formData = new FormData();
        siteSlideFiles.forEach((file) => formData.append("slides", file));
        const uploadRes = await fetch(`${API}/api/vine/site-visuals/ark-auth-slides`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });
        const uploadBody = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          showSiteVisualNotice("ark-slides", "error", uploadBody?.message || "Failed to upload ARK auth slides.");
          return;
        }
        nextArkSlides = [...nextArkSlides, ...((uploadBody?.urls || []).map((item) => String(item || "").trim()).filter(Boolean))];
      }

      if (siteActivitiesGalleryFiles.length) {
        const formData = new FormData();
        siteActivitiesGalleryFiles.forEach((file) => formData.append("images", file));
        const uploadRes = await fetch(`${API}/api/vine/site-visuals/activities-gallery`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });
        const uploadBody = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          showSiteVisualNotice("activities-gallery", "error", uploadBody?.message || "Failed to upload Activities gallery images.");
          return;
        }
        const uploadedActivitiesUrls = (uploadBody?.urls || [])
          .map((item) => String(item || "").trim())
          .filter(Boolean);
        nextActivitiesGallery = [
          ...uploadedActivitiesUrls,
          ...nextActivitiesGallery,
        ];
        const todayStamp = getKampalaDateStamp();
        nextActivitiesLatestBatch =
          nextActivitiesLatestDay === todayStamp
            ? [
                ...uploadedActivitiesUrls,
                ...nextActivitiesLatestBatch.filter((url) => !uploadedActivitiesUrls.includes(url)),
              ]
            : uploadedActivitiesUrls;
        nextActivitiesLatestDay = todayStamp;
      }

      if (!nextArkSlides.length) {
        showSiteVisualNotice("ark-slides", "error", "Please keep at least one ARK auth slide.");
        return;
      }

      if (!nextActivitiesGallery.length) {
        showSiteVisualNotice("activities-gallery", "error", "Please keep at least one Activities image.");
        return;
      }

      nextActivitiesLatestBatch = nextActivitiesLatestBatch.filter((url) => nextActivitiesGallery.includes(url));

      const res = await fetch(`${API}/api/vine/site-visuals/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          home_hero_url: nextHomeHeroUrl,
          boarding_login_url: nextBoardingLoginUrl,
          ark_auth_slides: nextArkSlides,
          activities_banner_url: nextActivitiesBannerUrl,
          contact_hero_url: nextContactHeroUrl,
          activities_gallery: nextActivitiesGallery,
          activities_latest_batch: nextActivitiesLatestBatch,
          activities_latest_day: nextActivitiesLatestDay,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showSiteVisualNotice(target, "error", body?.message || "Failed to save site visuals.");
        return;
      }

      const nextSettings = primeSiteVisualsCache(body.settings || {});
      setData((prev) => (prev ? { ...prev, siteVisualSettings: nextSettings } : prev));
      setSiteHeroFile(null);
      setSiteBoardingFile(null);
      setSiteActivitiesBannerFile(null);
      setSiteContactHeroFile(null);
      setSiteSlideFiles([]);
      setSiteActivitiesGalleryFiles([]);
      setDraggedActivityIndex(null);
      setDragOverActivityIndex(null);
      const successMessageByTarget = {
        "home-hero": "Homepage hero published beautifully.",
        "boarding-cover": "Boarding login cover is now live.",
        "activities-gallery": "Activities banner and gallery are now live.",
        "ark-slides": "ARK auth slideshow published successfully.",
        "contact-hero": "Contact hero is now live.",
      };
      showSiteVisualNotice(target, "success", successMessageByTarget[target] || "Visuals published successfully.");
    } catch {
      showSiteVisualNotice(target, "error", "Failed to save site visuals.");
    } finally {
      setSiteVisualSaving(false);
      setSiteVisualSavingTarget("");
    }
  };

  const resetActivitiesVisuals = async () => {
    try {
      setSiteVisualSaving(true);
      setSiteVisualSavingTarget("activities-reset");
      setSiteVisualNotice(null);
      const res = await fetch(`${API}/api/vine/site-visuals/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          home_hero_url: siteVisualForm.home_hero_url,
          boarding_login_url: siteVisualForm.boarding_login_url,
          ark_auth_slides: siteVisualForm.ark_auth_slides,
          activities_banner_url: DEFAULT_SITE_VISUAL_FORM.activities_banner_url,
          contact_hero_url: siteVisualForm.contact_hero_url,
          activities_gallery: DEFAULT_SITE_VISUAL_FORM.activities_gallery,
          activities_latest_batch: DEFAULT_SITE_VISUAL_FORM.activities_latest_batch,
          activities_latest_day: getKampalaDateStamp(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showSiteVisualNotice("activities-gallery", "error", body?.message || "Failed to reset Activities visuals.");
        return;
      }

      const nextSettings = primeSiteVisualsCache(body.settings || {});
      setData((prev) => (prev ? { ...prev, siteVisualSettings: nextSettings } : prev));
      setSiteActivitiesBannerFile(null);
      setSiteActivitiesGalleryFiles([]);
      setDraggedActivityIndex(null);
      setDragOverActivityIndex(null);
      showSiteVisualNotice("activities-gallery", "success", "Activities visuals reset to default.");
    } catch {
      showSiteVisualNotice("activities-gallery", "error", "Failed to reset Activities visuals.");
    } finally {
      setSiteVisualSaving(false);
      setSiteVisualSavingTarget("");
    }
  };

  const releaseNow = async (userId) => {
    if (!userId) return;
    try {
      const res = await fetch(`${API}/api/vine/moderation/unsuspend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_id: userId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body?.message || "Failed to release user");
        return;
      }
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          vinePrison: (prev.vinePrison || []).filter((p) => Number(p.user_id) !== Number(userId)),
        };
      });
    } catch {
      alert("Failed to release user");
    }
  };

  const k = data?.kpis || {};
  const leaderboard = data?.topPostsLeaderboard || { today: [], week: [] };
  const funnel = data?.growthFunnel || {};
  const contentHealth = data?.contentHealth || {};
  const engagementQuality = data?.engagementQuality || {};
  const networkEffects = data?.networkEffects || {};
  const alerts = data?.guardianAlerts || [];
  const creators = data?.creatorInsights || { topCreatorsWeek: [], risingCreators: [] };
  const mostActiveUsers = data?.mostActiveUsers || [];
  const vinePrison = data?.vinePrison || [];
  const activity = data?.activity || null;
  const lifecycleLogins = lifecycleAnalytics.logins;
  const newsHealth = data?.newsHealth || null;
  const newsRuntime = newsHealth?.runtime || {};
  const noticeSettings = data?.noticeSettings || null;
  const authThemeSettings = data?.authThemeSettings || null;
  const siteVisualNoticeLabel = SITE_VISUAL_NOTICE_LABELS[siteVisualNotice?.target] || "Visuals";
  const authThemePreviewUrl =
    authThemeCoverPreview ||
    withCacheBust(authThemeForm.cover_url || "/newactivities/fffffffffff.jpg", authThemeSettings?.updated_at);
  const siteVisualSettings = data?.siteVisualSettings || null;
  const siteHeroPreviewUrl =
    siteHeroPreview ||
    withCacheBust(
      siteVisualForm.home_hero_url || DEFAULT_SITE_VISUAL_FORM.home_hero_url,
      siteVisualSettings?.updated_at
    );
  const siteBoardingPreviewUrl =
    siteBoardingPreview ||
    withCacheBust(
      siteVisualForm.boarding_login_url || DEFAULT_SITE_VISUAL_FORM.boarding_login_url,
      siteVisualSettings?.updated_at
    );
  const siteActivitiesBannerPreviewUrl =
    siteActivitiesBannerPreview ||
    withCacheBust(
      siteVisualForm.activities_banner_url || DEFAULT_SITE_VISUAL_FORM.activities_banner_url,
      siteVisualSettings?.updated_at
    );
  const siteContactHeroPreviewUrl =
    siteContactHeroPreview ||
    withCacheBust(
      siteVisualForm.contact_hero_url || DEFAULT_SITE_VISUAL_FORM.contact_hero_url,
      siteVisualSettings?.updated_at
    );
  const recentLogins = activity?.recent_logins || EMPTY_ANALYTICS_ROWS;
  const recentActions = activity?.recent_actions || EMPTY_ANALYTICS_ROWS;
  const filteredRecentActions = useMemo(() => {
    if (activityFilter === "all" || activityFilter === "logins") return recentActions;
    if (activityFilter === "posts") {
      return recentActions.filter((row) => ["post"].includes(String(row.action_type || "").toLowerCase()));
    }
    if (activityFilter === "comments") {
      return recentActions.filter((row) => ["comment", "reply"].includes(String(row.action_type || "").toLowerCase()));
    }
    if (activityFilter === "dms") {
      return recentActions.filter((row) => String(row.action_type || "").toLowerCase() === "dm");
    }
    if (activityFilter === "follows") {
      return recentActions.filter((row) => String(row.action_type || "").toLowerCase() === "follow");
    }
    if (activityFilter === "communities") {
      return recentActions.filter((row) =>
        ["community_join", "assignment_submit"].includes(String(row.action_type || "").toLowerCase())
      );
    }
    return recentActions;
  }, [recentActions, activityFilter]);
  const activeFilterLabel =
    ACTIVITY_FILTER_OPTIONS.find(([value]) => value === activityFilter)?.[1] || "Everything";

  if (loading) {
    return <div className="guardian-analytics-page">Loading analytics...</div>;
  }

  if (error) {
    return <div className="guardian-analytics-page">{error}</div>;
  }

  return (
    <div className="guardian-analytics-page">
      {siteVisualNotice && (
        <div className="guardian-site-visual-toast-shell" aria-live="polite" aria-atomic="true">
          <div
            key={siteVisualNotice.shownAt}
            className={`guardian-site-visual-toast ${siteVisualNotice.kind}`}
            role="status"
            style={{
              "--guardian-visual-toast-duration": `${siteVisualNotice.durationMs || SITE_VISUAL_NOTICE_DURATION_MS}ms`,
            }}
          >
            <span className="guardian-site-visual-toast-mark">
              {siteVisualNotice.kind === "success" ? "Live now" : "Action needed"}
            </span>
            <div className="guardian-site-visual-toast-copy">
              <strong>
                {siteVisualNoticeLabel}{" "}
                {siteVisualNotice.kind === "success" ? "published beautifully." : "needs your attention."}
              </strong>
              <span>{siteVisualNotice.message}</span>
            </div>
            <button
              type="button"
              className="guardian-site-visual-toast-close"
              onClick={() => setSiteVisualNotice(null)}
            >
              Okay
            </button>
            <div className="guardian-site-visual-toast-progress" aria-hidden="true">
              <span key={`progress-${siteVisualNotice.shownAt}`} />
            </div>
          </div>
        </div>
      )}

      <div className="guardian-topbar">
        <button
          type="button"
          className="guardian-back-btn"
          aria-label="Back to Vine feed"
          onClick={() => navigate("/vine/feed")}
        >
          <span className="guardian-back-icon" aria-hidden="true">←</span>
          <span className="guardian-back-label">Vine feed</span>
        </button>
        <div className="guardian-title-wrap">
          <span className="guardian-title-kicker">Guardian workspace</span>
          <h2>Vine Guardian Analytics</h2>
          <p>Network health, controls and moderation</p>
        </div>
        <div className="guardian-range" aria-label="Analytics date range">
          <label>
            <span>From</span>
            <input aria-label="Analytics start date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <span className="guardian-range-divider" aria-hidden="true">→</span>
          <label>
            <span>To</span>
            <input aria-label="Analytics end date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>

      <nav className="guardian-jump-nav" aria-label="Guardian analytics sections">
        <a href="#guardian-overview">Overview</a>
        <a href="#guardian-controls">Controls</a>
        <a href="#guardian-activity">Activity</a>
        <a href="#guardian-insights">Insights</a>
        <a href="#guardian-moderation">Moderation</a>
      </nav>

      <section id="guardian-overview" className="guardian-kpi-board">
        <div className="guardian-kpi-board-head">
          <div className="guardian-kpi-heading">
            <span className="guardian-kpi-eyebrow">Vine Pulse</span>
            <h3>App heartbeat at a glance</h3>
          </div>
          <div className="guardian-kpi-spotlight">
            <span className="guardian-kpi-spotlight-label">Today&apos;s spotlight</span>
            <strong>{k.activeUsersToday ?? 0} active users</strong>
            <small>{k.loginsToday ?? 0} logins recorded today</small>
          </div>
        </div>

        <div className="guardian-kpi-grid">
          <div className="guardian-kpi-card">
            <span className="guardian-kpi-icon" aria-hidden="true">U</span>
            <span>Total Users</span>
            <strong>{k.totalUsers ?? 0}</strong>
          </div>
          <div className="guardian-kpi-card">
            <span className="guardian-kpi-icon" aria-hidden="true">●</span>
            <span>Active Users Today</span>
            <strong>{k.activeUsersToday ?? 0}</strong>
          </div>
          <div className="guardian-kpi-card">
            <span className="guardian-kpi-icon" aria-hidden="true">↗</span>
            <span>Logins Today</span>
            <strong>{k.loginsToday ?? 0}</strong>
          </div>
          <div className="guardian-kpi-card">
            <span className="guardian-kpi-icon" aria-hidden="true">H</span>
            <span>Estimated Active Hours Today</span>
            <strong>{k.estimatedActiveHoursToday ?? 0}</strong>
          </div>
          <div className="guardian-kpi-card">
            <span className="guardian-kpi-icon" aria-hidden="true">+</span>
            <span>Joined This Week</span>
            <strong>{k.joinedThisWeek ?? k.newUsersWeek ?? 0}</strong>
          </div>
          <div className="guardian-kpi-card">
            <span className="guardian-kpi-icon" aria-hidden="true">P</span>
            <span>Posts This Week</span>
            <strong>{k.postsWeek ?? 0}</strong>
          </div>
          <div className="guardian-kpi-card">
            <span className="guardian-kpi-icon" aria-hidden="true">I</span>
            <span>Total Interactions This Week</span>
            <strong>{k.totalInteractionsWeek ?? 0}</strong>
          </div>
        </div>

        <div className="guardian-kpi-actions">
          <button className="guardian-csv-btn" onClick={() => exportCsv("kpis.csv", [k])}>
            Export KPI CSV
          </button>
        </div>
      </section>

      <div id="guardian-logins" className="guardian-section guardian-section--analytics">
        <h3>Logins Per User</h3>
        <div className="guardian-actions">
          <button
            className="guardian-csv-btn"
            onClick={() => exportCsv("logins_per_user.csv", lifecycleLogins?.top_users || [])}
          >
            Export CSV
          </button>
        </div>
        {lifecycleAnalytics.loading.logins && !lifecycleLogins ? (
          <div className="guardian-empty">Loading login frequency...</div>
        ) : lifecycleAnalytics.errors.logins ? (
          <div className="guardian-empty">{lifecycleAnalytics.errors.logins}</div>
        ) : (
          <>
            <div className="guardian-compare-grid guardian-compare-grid-lifecycle">
              <div className="guardian-compare-card guardian-compare-card-premium">
                <span className="guardian-stat-label">Avg Logins Per Active User Today</span>
                <strong>{Number(lifecycleLogins?.average_logins_per_active_user_today || 0).toFixed(2)}</strong>
                <small>
                  {formatCount(lifecycleLogins?.total_logins_today)} logins across{" "}
                  {formatCount(lifecycleLogins?.active_users_today)} active users today
                </small>
              </div>
              <div className="guardian-compare-card guardian-compare-card-premium">
                <span className="guardian-stat-label">Logins Today</span>
                <strong>{formatCount(lifecycleLogins?.total_logins_today)}</strong>
                <small>Fresh sign-ins recorded today</small>
              </div>
              <div className="guardian-compare-card guardian-compare-card-premium">
                <span className="guardian-stat-label">Logins Last 7 Days</span>
                <strong>{formatCount(lifecycleLogins?.total_logins_last_7d)}</strong>
                <small>Rolling weekly login volume</small>
              </div>
            </div>
            <div className="guardian-table">
              {(lifecycleLogins?.top_users || []).length === 0 ? (
                <div className="guardian-empty">No login events in this range.</div>
              ) : (
                (lifecycleLogins?.top_users || []).map((user, index) => (
                  <button
                    key={`login-top-${user.user_id}`}
                    className="guardian-row"
                    onClick={() => navigate(`/vine/profile/${user.username}`)}
                  >
                    <span className="guardian-rank">#{index + 1}</span>
                    <span className="guardian-row-main">{user.display_name || user.username}</span>
                    <span className="guardian-row-meta">
                      Today {formatCount(user.logins_today)} • 7d {formatCount(user.logins_week)} • Range{" "}
                      {formatCount(user.logins_range)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <div id="guardian-controls" className="guardian-section guardian-section--control">
        <h3>Vine News Scheduler</h3>
        <div className="guardian-news-grid">
          <div className="guardian-news-card">
            <span className="guardian-news-label">Posting Days</span>
            <div className="guardian-news-weekdays">
              {NEWS_WEEKDAY_OPTIONS.map((option) => {
                const active = (newsForm.allowed_weekdays || []).includes(option.value);
                return (
                  <button
                    key={`news-day-${option.value}`}
                    type="button"
                    className={`guardian-news-day ${active ? "active" : ""}`}
                    onClick={() => toggleNewsWeekday(option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <small>
              Leave all days off only if you want Vine News paused until you choose days again.
            </small>
          </div>

          <div className="guardian-news-card">
            <span className="guardian-news-label">Posting Time</span>
            <div className="guardian-news-field-stack">
              <input
                type="time"
                className="guardian-news-time"
                value={formatTimeOfDay(newsForm.daily_hour, newsForm.daily_minute)}
                onChange={(e) => {
                  const [hour, minute] = String(e.target.value || "12:00").split(":");
                  setNewsForm((prev) => ({
                    ...prev,
                    daily_hour: Number(hour || 0),
                    daily_minute: Number(minute || 0),
                  }));
                }}
              />
              <input
                type="text"
                className="guardian-news-time guardian-news-timezone"
                value={newsForm.timezone || "Africa/Kampala"}
                onChange={(e) =>
                  setNewsForm((prev) => ({
                    ...prev,
                    timezone: e.target.value || "Africa/Kampala",
                  }))
                }
                placeholder="Timezone, e.g. Africa/Kampala"
              />
            </div>
            <small>Example timezone: Africa/Kampala</small>
          </div>

          <div className="guardian-news-card">
            <span className="guardian-news-label">Current Runtime</span>
            <div className="guardian-news-runtime">
              <span>
                Last ingest: <strong>{formatAgo(newsRuntime.last_ingest_at)}</strong>
              </span>
              <span>
                In flight: <strong>{newsRuntime.in_flight ? "Yes" : "No"}</strong>
              </span>
              <span>
                Feeds tracked: <strong>{Array.isArray(newsRuntime.feeds) ? newsRuntime.feeds.length : 0}</strong>
              </span>
              <span>
                Live schedule:{" "}
                <strong>
                  {(newsForm.allowed_weekdays || []).length
                    ? `${(newsForm.allowed_weekdays || [])
                        .map((value) => NEWS_WEEKDAY_OPTIONS.find((option) => option.value === value)?.label || value)
                        .join(", ")} at ${formatTimeOfDay(newsForm.daily_hour, newsForm.daily_minute)}`
                    : "Paused"}
                </strong>
              </span>
            </div>
            <div className="guardian-news-actions">
              <button
                type="button"
                className="guardian-csv-btn guardian-news-save"
                disabled={newsSaving}
                onClick={saveNewsSchedule}
              >
                {newsSaving ? "Saving..." : "Save schedule"}
              </button>
              <button
                type="button"
                className="guardian-csv-btn guardian-news-refresh"
                disabled={newsRefreshing}
                onClick={refreshNewsNow}
              >
                {newsRefreshing ? "Refreshing..." : "Refresh now"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="guardian-section guardian-section--notice">
        <h3>Login Notice</h3>
        <div className="guardian-news-grid">
          <div className="guardian-news-card guardian-notice-card">
            <span className="guardian-news-label">Notice Copy</span>
            <input
              type="text"
              className="guardian-news-time guardian-notice-input"
              value={noticeForm.title}
              maxLength={140}
              onChange={(e) =>
                setNoticeForm((prev) => ({
                  ...prev,
                  title: e.target.value,
                }))
              }
              placeholder="A quick Vine update"
            />
            <textarea
              className="guardian-news-time guardian-notice-message"
              value={noticeForm.message}
              maxLength={4000}
              onChange={(e) =>
                setNoticeForm((prev) => ({
                  ...prev,
                  message: e.target.value,
                }))
              }
              placeholder="Write the note people should see after login."
            />
            <small>Saving a changed notice republishes it once to everyone on their next login.</small>
          </div>

          <div className="guardian-news-card guardian-notice-card">
            <span className="guardian-news-label">Publishing</span>
            <label className="guardian-notice-toggle">
              <input
                type="checkbox"
                checked={Boolean(noticeForm.enabled)}
                onChange={(e) =>
                  setNoticeForm((prev) => ({
                    ...prev,
                    enabled: e.target.checked,
                  }))
                }
              />
              <span>{noticeForm.enabled ? "Show this notice on login" : "Keep notice turned off"}</span>
            </label>
            <div className="guardian-news-runtime">
              <span>
                Current version: <strong>{noticeSettings?.version || "Draft only"}</strong>
              </span>
              <span>
                Last updated: <strong>{noticeSettings?.updated_at ? formatAgo(noticeSettings.updated_at) : "Not yet"}</strong>
              </span>
              <span>
                Delivery: <strong>{noticeForm.enabled ? "Shows once until user taps Okay" : "Disabled"}</strong>
              </span>
            </div>
            <div className="guardian-news-actions">
              <button
                type="button"
                className="guardian-csv-btn guardian-news-save"
                disabled={noticeSaving}
                onClick={saveSystemNotice}
              >
                {noticeSaving ? "Saving..." : noticeForm.enabled ? "Publish notice" : "Save disabled state"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="guardian-section guardian-section--theme">
        <h3>Auth Theme</h3>
        <div className="guardian-news-grid">
          <div className="guardian-news-card guardian-auth-theme-card">
            <span className="guardian-news-label">Cover</span>
            <div
              className={`guardian-auth-theme-preview guardian-auth-effect-${authThemeForm.effect_preset} guardian-auth-align-${authThemeForm.form_alignment}`}
              style={{ "--guardian-auth-cover": `url(${authThemePreviewUrl})` }}
            >
              {authThemeForm.effect_preset === "floral" && (
                <div className="guardian-auth-florals" aria-hidden="true">
                  <span className="guardian-auth-flower guardian-auth-flower-top" />
                  <span className="guardian-auth-flower guardian-auth-flower-bottom" />
                </div>
              )}
              <div className="guardian-auth-preview-card">
                <strong>SPESS Vine</strong>
                <span>Login, signup, and reset all use this scene.</span>
              </div>
            </div>
            <label className="guardian-auth-upload-shell">
              <span className="guardian-auth-upload-label">Upload a new cover</span>
              <input
                className="guardian-auth-upload-input"
                type="file"
                accept="image/*"
                onChange={(e) => setAuthThemeCoverFile(e.target.files?.[0] || null)}
              />
              <span className="guardian-auth-upload-cta">Choose cover</span>
              <span className="guardian-auth-upload-copy">
                {authThemeCoverFile ? authThemeCoverFile.name : "No new file selected yet"}
              </span>
            </label>
            {authThemeCoverFile && (
              <button
                type="button"
                className="guardian-csv-btn guardian-auth-clear"
                onClick={() => setAuthThemeCoverFile(null)}
              >
                Clear selection
              </button>
            )}
            <small>
              {authThemeCoverFile
                ? `Ready to publish: ${authThemeCoverFile.name}`
                : "Upload once here and it will flow into login, signup, and forgot password."}
            </small>
          </div>

          <div className="guardian-news-card guardian-auth-theme-card">
            <span className="guardian-news-label">Look & Layout</span>
            <div className="guardian-auth-field-stack">
              <label>
                <span className="guardian-auth-field-label">Effect preset</span>
                <select
                  className="guardian-news-time"
                  value={authThemeForm.effect_preset}
                  onChange={(e) =>
                    setAuthThemeForm((prev) => ({
                      ...prev,
                      effect_preset: e.target.value,
                    }))
                  }
                >
                  {AUTH_THEME_EFFECT_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="guardian-auth-field-label">Form alignment</span>
                <select
                  className="guardian-news-time"
                  value={authThemeForm.form_alignment}
                  onChange={(e) =>
                    setAuthThemeForm((prev) => ({
                      ...prev,
                      form_alignment: e.target.value,
                    }))
                  }
                >
                  {AUTH_THEME_ALIGNMENT_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="guardian-news-runtime">
              <span>
                Current effect: <strong>{authThemeSettings?.effect_preset || authThemeForm.effect_preset}</strong>
              </span>
              <span>
                Current alignment: <strong>{authThemeSettings?.form_alignment || authThemeForm.form_alignment}</strong>
              </span>
              <span>
                Last updated: <strong>{authThemeSettings?.updated_at ? formatAgo(authThemeSettings.updated_at) : "Not yet"}</strong>
              </span>
            </div>
            <div className="guardian-news-actions">
              <button
                type="button"
                className="guardian-csv-btn guardian-news-save-hot"
                disabled={authThemeSaving}
                onClick={saveAuthTheme}
              >
                {authThemeSaving ? "Publishing..." : "Publish auth theme"}
              </button>
              <button
                type="button"
                className="guardian-csv-btn guardian-auth-reset"
                disabled={authThemeSaving}
                onClick={resetAuthTheme}
              >
                Reset to default
              </button>
            </div>
            {authThemeNotice && (
              <div className={`guardian-auth-notice ${authThemeNotice.kind}`}>
                <span>{authThemeNotice.kind === "success" ? "Done" : "Heads up"}</span>
                <strong>{authThemeNotice.message}</strong>
                <button
                  type="button"
                  className="guardian-auth-notice-close"
                  onClick={() => setAuthThemeNotice(null)}
                >
                  Okay
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="guardian-section guardian-section--visuals">
        <h3>Website, Activities, Ark & Boarding Visuals</h3>
        <div className="guardian-news-card guardian-community-control-card">
          <span className="guardian-news-label">Communities Control</span>
          <label className="guardian-notice-toggle">
            <input
              type="checkbox"
              checked={Boolean(siteVisualForm.create_community_enabled)}
              disabled={siteVisualSaving && siteVisualSavingTarget === "community-create-toggle"}
              onChange={(e) => saveCommunityCreateToggle(e.target.checked)}
            />
            <span>
              {siteVisualForm.create_community_enabled
                ? "Show Create Community button"
                : "Hide Create Community button"}
            </span>
          </label>
          <p className="guardian-community-control-copy">
            Turn this off when you do not want learners creating new communities from the Communities page.
          </p>
        </div>
        <div className="guardian-site-visual-layout">
          <div className="guardian-site-visual-stack">
            <div className="guardian-news-card guardian-auth-theme-card">
              <span className="guardian-news-label">Homepage Hero</span>
              <div
                className="guardian-site-hero-preview"
                style={{ "--guardian-site-hero": `url(${siteHeroPreviewUrl})` }}
              >
                <div className="guardian-site-hero-copy">
                  <strong>Website front door</strong>
                  <span>This drives the very first school homepage image.</span>
                </div>
              </div>
              <label className="guardian-auth-upload-shell">
                <span className="guardian-auth-upload-label">Upload homepage hero</span>
                <input
                  className="guardian-auth-upload-input"
                  type="file"
                  accept="image/*,.heic,.heif"
                  onChange={handleSiteHeroPick}
                />
                <span className="guardian-auth-upload-cta">Choose hero image</span>
                <span className="guardian-auth-upload-copy">
                  {siteHeroFile ? siteHeroFile.name : "No new homepage image selected"}
                </span>
              </label>
              <div className="guardian-news-actions guardian-site-card-actions">
                {siteHeroFile && (
                  <button
                    type="button"
                    className="guardian-csv-btn guardian-auth-clear"
                    onClick={() => setSiteHeroFile(null)}
                  >
                    Clear selection
                  </button>
                )}
                <button
                  type="button"
                  className="guardian-csv-btn guardian-news-save-hot"
                  disabled={siteVisualSaving}
                  onClick={() => saveSiteVisuals("home-hero")}
                >
                  {siteVisualSaving && siteVisualSavingTarget === "home-hero" ? "Publishing..." : "Publish visuals"}
                </button>
              </div>
            </div>

            <div className="guardian-news-card guardian-auth-theme-card">
              <span className="guardian-news-label">Boarding Login Cover</span>
              <div
                className="guardian-site-hero-preview guardian-site-boarding-preview"
                style={{ "--guardian-site-hero": `url(${siteBoardingPreviewUrl})` }}
              >
                <div className="guardian-site-hero-copy">
                  <strong>Boarding manager entry</strong>
                  <span>This controls the standalone Boarding login screen.</span>
                </div>
              </div>
              <label className="guardian-auth-upload-shell">
                <span className="guardian-auth-upload-label">Upload Boarding login cover</span>
                <input
                  className="guardian-auth-upload-input"
                  type="file"
                  accept="image/*,.heic,.heif"
                  onChange={handleBoardingPick}
                />
                <span className="guardian-auth-upload-cta">Choose Boarding image</span>
                <span className="guardian-auth-upload-copy">
                  {siteBoardingFile ? siteBoardingFile.name : "No new Boarding image selected"}
                </span>
              </label>
              <div className="guardian-news-actions guardian-site-card-actions">
                {siteBoardingFile && (
                  <button
                    type="button"
                    className="guardian-csv-btn guardian-auth-clear"
                    onClick={() => setSiteBoardingFile(null)}
                  >
                    Clear selection
                  </button>
                )}
                <button
                  type="button"
                  className="guardian-csv-btn guardian-news-save-hot"
                  disabled={siteVisualSaving}
                  onClick={() => saveSiteVisuals("boarding-cover")}
                >
                  {siteVisualSaving && siteVisualSavingTarget === "boarding-cover" ? "Publishing..." : "Publish visuals"}
                </button>
              </div>
              <div className="guardian-news-runtime">
                <span>
                  Boarding cover: <strong>{siteVisualForm.boarding_login_url ? "Live" : "Default"}</strong>
                </span>
                <span>
                  Covers: <strong>Boarding login</strong>
                </span>
              </div>
            </div>

            <div className="guardian-news-card guardian-auth-theme-card">
              <span className="guardian-news-label">Activities Gallery</span>
              <div
                className="guardian-site-hero-preview guardian-site-activities-preview"
                style={{ "--guardian-site-hero": `url(${siteActivitiesBannerPreviewUrl})` }}
              >
                <div className="guardian-site-hero-copy">
                  <strong>Activities page banner</strong>
                  <span>This controls the hero image at the top of the Activities page.</span>
                </div>
              </div>
              <label className="guardian-auth-upload-shell">
                <span className="guardian-auth-upload-label">Upload Activities banner</span>
                <input
                  className="guardian-auth-upload-input"
                  type="file"
                  accept="image/*,.heic,.heif"
                  onChange={handleActivitiesBannerPick}
                />
                <span className="guardian-auth-upload-cta">Choose banner image</span>
                <span className="guardian-auth-upload-copy">
                  {siteActivitiesBannerFile ? siteActivitiesBannerFile.name : "No new Activities banner selected"}
                </span>
              </label>

              <div className="guardian-activities-helper">
                Drag the gallery cards below to change the order visitors see on the Activities page.
              </div>

              <div className="guardian-activities-scroll">
                <div className="guardian-slide-grid guardian-activities-grid">
                  {(siteVisualForm.activities_gallery || []).map((imageUrl, index) => (
                    <div
                      key={`${imageUrl}-${index}`}
                      className={`guardian-slide-chip guardian-activities-chip ${
                        draggedActivityIndex === index ? "dragging" : ""
                      } ${dragOverActivityIndex === index ? "drag-target" : ""}`}
                      draggable
                      onDragStart={() => {
                        setDraggedActivityIndex(index);
                        setDragOverActivityIndex(index);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (dragOverActivityIndex !== index) {
                          setDragOverActivityIndex(index);
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedActivityIndex !== null) {
                          reorderActivitiesImage(draggedActivityIndex, index);
                        }
                        setDraggedActivityIndex(null);
                        setDragOverActivityIndex(null);
                      }}
                      onDragEnd={() => {
                        setDraggedActivityIndex(null);
                        setDragOverActivityIndex(null);
                      }}
                    >
                      <span className="guardian-activities-chip-order">#{index + 1}</span>
                      <img
                        src={withCacheBust(imageUrl, siteVisualSettings?.updated_at)}
                        alt={`Activity ${index + 1}`}
                        loading="lazy"
                      />
                      <button
                        type="button"
                        className="guardian-slide-remove"
                        disabled={siteVisualSaving}
                        onClick={() => removeActivitiesImage(imageUrl)}
                      >
                        {siteVisualSaving && siteVisualSavingTarget === "activities-gallery-remove"
                          ? "Removing..."
                          : "Remove"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <label className="guardian-auth-upload-shell">
                <span className="guardian-auth-upload-label">Add Activities gallery images</span>
                <input
                  className="guardian-auth-upload-input"
                  type="file"
                  accept="image/*,.heic,.heif"
                  multiple
                  onChange={handleActivitiesGalleryPick}
                />
                <span className="guardian-auth-upload-cta">Choose Activities images</span>
                <span className="guardian-auth-upload-copy">
                  {siteActivitiesGalleryFiles.length
                    ? `${siteActivitiesGalleryFiles.length} new image${siteActivitiesGalleryFiles.length === 1 ? "" : "s"} ready`
                    : "No new Activities images selected"}
                </span>
              </label>
              <div className="guardian-news-actions guardian-site-card-actions guardian-site-card-actions-wrap">
                {siteActivitiesBannerFile && (
                  <button
                    type="button"
                    className="guardian-csv-btn guardian-auth-clear"
                    onClick={() => setSiteActivitiesBannerFile(null)}
                  >
                    Clear banner
                  </button>
                )}
                {siteActivitiesGalleryFiles.length > 0 && (
                  <button
                    type="button"
                    className="guardian-csv-btn guardian-auth-clear"
                    onClick={() => setSiteActivitiesGalleryFiles([])}
                  >
                    Clear new images
                  </button>
                )}
                <button
                  type="button"
                  className="guardian-csv-btn guardian-auth-reset"
                  disabled={siteVisualSaving}
                  onClick={resetActivitiesVisuals}
                >
                  {siteVisualSaving && siteVisualSavingTarget === "activities-reset" ? "Resetting..." : "Reset Activities"}
                </button>
                <button
                  type="button"
                  className="guardian-csv-btn guardian-news-save-hot"
                  disabled={siteVisualSaving}
                  onClick={() => saveSiteVisuals("activities-gallery")}
                >
                  {siteVisualSaving && siteVisualSavingTarget === "activities-gallery" ? "Publishing..." : "Publish visuals"}
                </button>
              </div>
              <div className="guardian-news-runtime">
                <span>
                  Activities banner: <strong>{siteVisualForm.activities_banner_url ? "Live" : "Default"}</strong>
                </span>
                <span>
                  Gallery images live: <strong>{(siteVisualForm.activities_gallery || []).length}</strong>
                </span>
                <span>
                  Covers: <strong>Activities page banner + gallery</strong>
                </span>
              </div>
            </div>
          </div>

          <div className="guardian-site-visual-stack">
            <div className="guardian-news-card guardian-auth-theme-card">
              <span className="guardian-news-label">ARK Auth Slideshow</span>
              <div className="guardian-visual-usage">
                <span className="guardian-visual-usage-pill">Admin Login</span>
                <span className="guardian-visual-usage-pill">Teacher Login</span>
                <span className="guardian-visual-usage-pill">Teacher Signup</span>
                <span className="guardian-visual-usage-pill">Teacher Reset</span>
              </div>
              <div className="guardian-slide-grid">
                {(siteVisualForm.ark_auth_slides || []).map((slideUrl, index) => (
                  <div key={`${slideUrl}-${index}`} className="guardian-slide-chip">
                    <img
                      src={withCacheBust(slideUrl, siteVisualSettings?.updated_at)}
                      alt={`Ark slide ${index + 1}`}
                      loading="lazy"
                    />
                    <button
                      type="button"
                      className="guardian-slide-remove"
                      onClick={() => removeArkAuthSlide(slideUrl)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <label className="guardian-auth-upload-shell">
                <span className="guardian-auth-upload-label">Add slides for ARK admin and teacher auth screens</span>
                <input
                  className="guardian-auth-upload-input"
                  type="file"
                  accept="image/*,.heic,.heif"
                  multiple
                  onChange={handleSiteSlidesPick}
                />
                <span className="guardian-auth-upload-cta">Choose slideshow images</span>
                <span className="guardian-auth-upload-copy">
                  {siteSlideFiles.length
                    ? `${siteSlideFiles.length} new slide${siteSlideFiles.length === 1 ? "" : "s"} ready`
                    : "No new slideshow images selected"}
                </span>
              </label>
              {siteSlideFiles.length > 0 && (
                <button
                  type="button"
                  className="guardian-csv-btn guardian-auth-clear"
                  onClick={() => setSiteSlideFiles([])}
                >
                  Clear new slides
                </button>
              )}
              <div className="guardian-news-runtime">
                <span>
                  ARK visuals updated: <strong>{siteVisualSettings?.updated_at ? formatAgo(siteVisualSettings.updated_at) : "Not yet"}</strong>
                </span>
                <span>
                  ARK slides live: <strong>{(siteVisualForm.ark_auth_slides || []).length}</strong>
                </span>
                <span>
                  Covers: <strong>ARK admin / teacher auth</strong>
                </span>
              </div>
              <div className="guardian-news-actions">
                <button
                  type="button"
                  className="guardian-csv-btn guardian-news-save-hot"
                  disabled={siteVisualSaving}
                  onClick={() => saveSiteVisuals("ark-slides")}
                >
                  {siteVisualSaving && siteVisualSavingTarget === "ark-slides" ? "Publishing..." : "Publish visuals"}
                </button>
              </div>
            </div>

            <div className="guardian-news-card guardian-auth-theme-card">
              <span className="guardian-news-label">Contact Hero</span>
              <div
                className="guardian-site-hero-preview guardian-site-contact-preview"
                style={{ "--guardian-site-hero": `url(${siteContactHeroPreviewUrl})` }}
              >
                <div className="guardian-site-hero-copy">
                  <strong>Get in touch banner</strong>
                  <span>This controls the Contact / Get in touch hero image on the website.</span>
                </div>
              </div>
              <label className="guardian-auth-upload-shell">
                <span className="guardian-auth-upload-label">Upload Contact hero</span>
                <input
                  className="guardian-auth-upload-input"
                  type="file"
                  accept="image/*,.heic,.heif"
                  onChange={handleContactHeroPick}
                />
                <span className="guardian-auth-upload-cta">Choose Contact image</span>
                <span className="guardian-auth-upload-copy">
                  {siteContactHeroFile ? siteContactHeroFile.name : "No new Contact image selected"}
                </span>
              </label>
              <div className="guardian-news-actions guardian-site-card-actions">
                {siteContactHeroFile && (
                  <button
                    type="button"
                    className="guardian-csv-btn guardian-auth-clear"
                    onClick={() => setSiteContactHeroFile(null)}
                  >
                    Clear selection
                  </button>
                )}
                <button
                  type="button"
                  className="guardian-csv-btn guardian-news-save-hot"
                  disabled={siteVisualSaving}
                  onClick={() => saveSiteVisuals("contact-hero")}
                >
                  {siteVisualSaving && siteVisualSavingTarget === "contact-hero" ? "Publishing..." : "Publish visuals"}
                </button>
              </div>
              <div className="guardian-news-runtime">
                <span>
                  Contact hero: <strong>{siteVisualForm.contact_hero_url ? "Live" : "Default"}</strong>
                </span>
                <span>
                  Covers: <strong>Contact / Get in touch</strong>
                </span>
              </div>
            </div>

          </div>
        </div>
      </div>

      <div id="guardian-activity" className="guardian-section guardian-section--activity">
        <h3>Network Activity Log</h3>
        <div className="guardian-actions">
          <button
            className="guardian-csv-btn"
            onClick={() => exportCsv("guardian_recent_logins.csv", recentLogins)}
          >
            Export Logins CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => exportCsv("guardian_recent_actions.csv", recentActions)}
          >
            Export Actions CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() =>
              exportActivityPdf({
                mode: "logins",
                recentLogins,
                filteredRecentActions,
                activityFilter,
              })
            }
          >
            Export Logins PDF
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() =>
              exportActivityPdf({
                mode: "current",
                recentLogins,
                filteredRecentActions,
                activityFilter,
              })
            }
          >
            Export {activityFilter === "logins" ? "Logins" : activeFilterLabel} PDF
          </button>
        </div>
        <div className="guardian-perf-refresh">
          <span>Recent Vine logins and live action logs. Guardian and Vine News are excluded from this view.</span>
          <span>Last update: {formatAgo(activityLastFetchedAt)}</span>
        </div>
        <div className="guardian-filter-row">
          {ACTIVITY_FILTER_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`guardian-filter-chip ${activityFilter === value ? "active" : ""}`}
              onClick={() => setActivityFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="guardian-activity-split">
          {activityFilter !== "logins" && (
            <div className="guardian-subsection">
              <h4>Recent Actions</h4>
              <div className="guardian-table">
                {filteredRecentActions.length === 0 && <div className="guardian-empty">No actions captured yet.</div>}
                {filteredRecentActions.map((row) => {
                  const specialBadge = hasSpecialVerifiedBadge(row);
                  return (
                    <button
                      key={`guardian-action-${row.event_key}`}
                      className="guardian-row guardian-row-activity"
                      onClick={() => navigate(row.navigate_path || `/vine/profile/${row.username}`)}
                    >
                      <span className="guardian-activity-user">
                        {row.avatar_url ? (
                          <img
                            className="guardian-activity-avatar"
                            src={row.avatar_url}
                            alt={row.display_name || row.username}
                            loading="lazy"
                          />
                        ) : (
                          <span className="guardian-activity-avatar guardian-activity-avatar-fallback">
                            {getInitials(row.display_name || row.username)}
                          </span>
                        )}
                        <span className="guardian-activity-user-copy">
                          <strong>
                            {row.display_name || row.username}
                            {(Number(row.is_verified) === 1 || specialBadge) && (
                              <span className={`guardian-verified ${specialBadge ? "guardian" : ""}`}>✓</span>
                            )}
                          </strong>
                          <small>@{row.username}</small>
                        </span>
                      </span>
                      <span className="guardian-row-main guardian-activity-main">
                        <strong>{getActivityIcon(row.action_type)} {row.action_label}</strong>
                        <small>
                          {row.target_label || "Vine"} • {formatAgo(row.created_at)}
                          {row.is_online_now ? " • online now" : ""}
                        </small>
                        <em className="guardian-activity-note">
                          {row.detail || "Open to inspect the user or jump into the target context."}
                        </em>
                      </span>
                      <span className={`guardian-activity-pill ${row.is_online_now ? "active" : "idle"}`}>
                        {row.is_online_now ? "Live" : "Seen"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="guardian-subsection">
            <h4>Recent Logins</h4>
            <div className="guardian-table">
              {recentLogins.length === 0 && <div className="guardian-empty">No recent logins captured yet.</div>}
              {recentLogins.map((row) => {
                const specialBadge = hasSpecialVerifiedBadge(row);
                return (
                  <button
                    key={`guardian-login-${row.session_id}`}
                    className="guardian-row guardian-row-activity"
                    onClick={() => navigate(row.navigate_path || `/vine/profile/${row.username}`)}
                  >
                    <span className="guardian-activity-user">
                      {row.avatar_url ? (
                        <img
                          className="guardian-activity-avatar"
                          src={row.avatar_url}
                          alt={row.display_name || row.username}
                          loading="lazy"
                        />
                      ) : (
                        <span className="guardian-activity-avatar guardian-activity-avatar-fallback">
                          {getInitials(row.display_name || row.username)}
                        </span>
                      )}
                      <span className="guardian-activity-user-copy">
                        <strong>
                          {row.display_name || row.username}
                          {(Number(row.is_verified) === 1 || specialBadge) && (
                            <span className={`guardian-verified ${specialBadge ? "guardian" : ""}`}>✓</span>
                          )}
                        </strong>
                        <small>@{row.username} • {row.device_label}</small>
                      </span>
                    </span>
                    <span className="guardian-row-main guardian-activity-main">
                      <strong>Logged in {formatAgo(row.login_at)}</strong>
                      <small>
                        {row.is_online_now ? "Online now" : `Seen ${formatAgo(row.last_seen_at)}`} • {row.actions_since_login || 0} action
                        {Number(row.actions_since_login || 0) === 1 ? "" : "s"} since login
                      </small>
                      {Array.isArray(row.recent_actions_preview) && row.recent_actions_preview.length > 0 ? (
                        <div className="guardian-activity-preview-list">
                          {row.recent_actions_preview.map((activity) => (
                            <div
                              key={`${row.session_id}-${activity.event_key}`}
                              className="guardian-activity-preview-item"
                            >
                              <span className="guardian-activity-preview-icon">
                                {getActivityIcon(activity.action_type)}
                              </span>
                              <span className="guardian-activity-preview-copy">
                                {activity.action_label}
                                {activity.target_label ? ` • ${activity.target_label}` : ""}
                                {activity.created_at ? ` • ${formatAgo(activity.created_at)}` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <em className="guardian-activity-note">No action after login yet</em>
                      )}
                    </span>
                    <span className={`guardian-activity-pill ${String(row.session_state || "").toLowerCase()}`}>
                      {getActivityStateLabel(row)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div id="guardian-insights" className="guardian-insights-grid">
      <div className="guardian-section guardian-section--insight">
        <h3>Most Active Users (Range)</h3>
        <div className="guardian-actions">
          <button className="guardian-csv-btn" onClick={() => exportCsv("most_active_users.csv", mostActiveUsers)}>
            Export CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=users&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-table">
          {mostActiveUsers.length === 0 && <div className="guardian-empty">No user activity in this range.</div>}
          {mostActiveUsers.map((u, idx) => (
            <button
              key={`active-user-${u.user_id}`}
              className="guardian-row"
              onClick={() => navigate(`/vine/profile/${u.username}`)}
            >
              <span className="guardian-rank">#{idx + 1}</span>
              <span className="guardian-row-main">{u.display_name || u.username}</span>
              <span className="guardian-row-meta">
                Score {u.score} • Posts {u.posts_count} • Comments {u.comments_count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="guardian-section guardian-section--insight">
        <h3>Top Posts Leaderboard (7d)</h3>
        <div className="guardian-actions">
          <button className="guardian-csv-btn" onClick={() => exportCsv("top_posts_week.csv", leaderboard.week)}>
            Export CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=posts&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-table">
          {leaderboard.week.length === 0 && <div className="guardian-empty">No posts in this range.</div>}
          {leaderboard.week.map((p, idx) => (
            <button
              key={`week-post-${p.id}`}
              className="guardian-row"
              onClick={() => navigate(`/vine/feed?post=${p.id}`)}
            >
              <span className="guardian-rank">#{idx + 1}</span>
              <span className="guardian-row-main">
                {p.display_name || p.username} • {String(p.content || "").slice(0, 80) || "Photo post"}
              </span>
              <span className="guardian-row-meta">Score {p.score}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="guardian-section guardian-section--insight">
        <h3>Growth Funnel (7d)</h3>
        <button
          className="guardian-csv-btn"
          onClick={() =>
            exportCsv("growth_funnel.csv", [
              {
                newUsers7d: funnel.newUsers7d ?? 0,
                postedByNewUsers7d: funnel.postedByNewUsers7d ?? 0,
                engagedByNewUsers7d: funnel.engagedByNewUsers7d ?? 0,
                eligibleRetentionUsers: funnel.eligibleRetentionUsers ?? 0,
                retainedAfter1d: funnel.retainedAfter1d ?? 0,
                retentionRatePct: funnel.retentionRatePct ?? 0,
              },
            ])
          }
        >
          Export CSV
        </button>
        <div className="guardian-funnel-grid">
          <div className="guardian-funnel-step">New Users: {funnel.newUsers7d ?? 0}</div>
          <div className="guardian-funnel-step">Posted: {funnel.postedByNewUsers7d ?? 0}</div>
          <div className="guardian-funnel-step">Got Engagement: {funnel.engagedByNewUsers7d ?? 0}</div>
          <div className="guardian-funnel-step">D1 Retention: {funnel.retentionRatePct ?? 0}%</div>
        </div>
      </div>

      <div className="guardian-section guardian-section--insight">
        <h3>Content Health</h3>
        <div className="guardian-actions">
          <button
            className="guardian-csv-btn"
            onClick={() => exportCsv("content_health.csv", [contentHealth])}
          >
            Export CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=posts&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-compare-grid">
          <div className="guardian-compare-card">Avg Post Length (7d): {contentHealth.avgPostLengthWeek ?? 0}</div>
          <div className="guardian-compare-card">Image Post Ratio (7d): {contentHealth.imagePostRatioWeek ?? 0}%</div>
          <div className="guardian-compare-card">Link Post Ratio (7d): {contentHealth.linkPostRatioWeek ?? 0}%</div>
          <div className="guardian-compare-card">Comments per Post (7d): {contentHealth.commentsPerPostWeek ?? 0}</div>
        </div>
      </div>

      <div className="guardian-section guardian-section--insight">
        <h3>Engagement Quality</h3>
        <div className="guardian-actions">
          <button
            className="guardian-csv-btn"
            onClick={() => exportCsv("engagement_quality.csv", [engagementQuality])}
          >
            Export CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=comments&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-compare-grid">
          <div className="guardian-compare-card">Interactions per Active User: {engagementQuality.interactionsPerActiveUserWeek ?? 0}</div>
          <div className="guardian-compare-card">Engagement per Post: {engagementQuality.engagementPerPostWeek ?? 0}</div>
          <div className="guardian-compare-card">Reply Share: {engagementQuality.replyShareWeek ?? 0}%</div>
        </div>
      </div>

      <div className="guardian-section guardian-section--insight">
        <h3>Network Effects</h3>
        <div className="guardian-actions">
          <button className="guardian-csv-btn" onClick={() => exportCsv("network_effects.csv", [networkEffects])}>
            Export CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=users&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-compare-grid">
          <div className="guardian-compare-card">Follows (7d): {networkEffects.followsWeek ?? 0}</div>
          <div className="guardian-compare-card">Follows per Active User: {networkEffects.followsPerActiveUserWeek ?? 0}</div>
          <div className="guardian-compare-card">Mutual Follow Pairs: {networkEffects.mutualFollowPairs ?? 0}</div>
          <div className="guardian-compare-card">New DM Threads (7d): {networkEffects.dmStartsWeek ?? 0}</div>
        </div>
      </div>

      <div id="guardian-moderation" className="guardian-section guardian-section--moderation guardian-section--wide">
        <h3>Vine Prison (Active Suspensions)</h3>
        <button className="guardian-csv-btn" onClick={() => exportCsv("vine_prison.csv", vinePrison)}>
          Export CSV
        </button>
        <div className="guardian-table">
          {vinePrison.length === 0 && <div className="guardian-empty">No active suspensions.</div>}
          {vinePrison.map((p) => (
            <div
              key={`prison-${p.id}`}
              className="guardian-row guardian-row-moderation"
            >
              <span className="guardian-row-main">
                {p.display_name || p.username} • {p.sentence_label}
              </span>
              <span className="guardian-row-meta">
                Start {new Date(p.starts_at).toLocaleString()} • Release {p.ends_at ? new Date(p.ends_at).toLocaleString() : "Indefinite"}
              </span>
              <div className="guardian-row-actions">
                <button
                  className="guardian-csv-btn"
                  onClick={() => navigate(`/vine/profile/${p.username}`)}
                >
                  Open
                </button>
                <button
                  className="guardian-release-btn"
                  onClick={() => releaseNow(p.user_id)}
                >
                  Release Now
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="guardian-section guardian-section--alerts">
        <h3>Guardian Alerts</h3>
        <div className="guardian-actions">
          <button className="guardian-csv-btn" onClick={() => exportCsv("guardian_alerts.csv", alerts)}>
            Export CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=posts&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-table">
          {alerts.length === 0 && <div className="guardian-empty">No alerts above threshold.</div>}
          {alerts.map((a) => (
            <div key={a.key} className={`guardian-row guardian-row-alert ${a.severity === "high" ? "alert-high" : a.severity === "medium" ? "alert-medium" : ""}`}>
              <span className="guardian-row-main">{a.label}</span>
              <span className="guardian-row-meta">
                {a.current} vs {a.previous} ({a.changePct}%)
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="guardian-section guardian-section--creators guardian-section--wide">
        <h3>Creator Insights (Global)</h3>
        <div className="guardian-actions">
          <button className="guardian-csv-btn" onClick={() => exportCsv("top_creators_week.csv", creators.topCreatorsWeek || [])}>
            Export Top CSV
          </button>
          <button className="guardian-csv-btn" onClick={() => exportCsv("rising_creators.csv", creators.risingCreators || [])}>
            Export Rising CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=creators&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-subsection">
          <h4>Top Creators (7d)</h4>
          <div className="guardian-table">
            {creators.topCreatorsWeek?.length === 0 && <div className="guardian-empty">No creator data.</div>}
            {(creators.topCreatorsWeek || []).map((c, idx) => (
              <button
                key={`creator-top-${c.user_id}`}
                className="guardian-row"
                onClick={() => navigate(`/vine/profile/${c.username}`)}
              >
                <span className="guardian-rank">#{idx + 1}</span>
                <span className="guardian-row-main">{c.display_name || c.username}</span>
                <span className="guardian-row-meta">Score {c.score_week}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="guardian-subsection">
          <h4>Rising Creators</h4>
          <div className="guardian-table">
            {creators.risingCreators?.length === 0 && <div className="guardian-empty">No rising creator data.</div>}
            {(creators.risingCreators || []).map((c, idx) => (
              <button
                key={`creator-rise-${c.user_id}`}
                className="guardian-row"
                onClick={() => navigate(`/vine/profile/${c.username}`)}
              >
                <span className="guardian-rank">#{idx + 1}</span>
                <span className="guardian-row-main">{c.display_name || c.username}</span>
                <span className="guardian-row-meta">Growth {c.growthPct}%</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
