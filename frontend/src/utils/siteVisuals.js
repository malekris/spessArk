import { useEffect, useState } from "react";
import { withCacheBust } from "./cacheBust";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const SITE_VISUAL_CACHE_MS = 60 * 1000;

export const DEFAULT_ACTIVITY_GALLERY_IMAGES = [
  "/newactivities/IMG_5033.jpg",
  "/newactivities/IMG_5036.jpg",
  "/newactivities/IMG_5038.jpg",
  "/newactivities/IMG_5045%202.jpg",
  "/newactivities/IMG_5049%202.jpg",
  "/newactivities/IMG_5050.jpg",
  "/newactivities/IMG_5054.jpg",
  "/newactivities/IMG_5055.jpg",
  "/newactivities/IMG_5061.jpg",
  "/newactivities/IMG_5063.jpg",
  "/newactivities/IMG_5067.jpg",
  "/newactivities/IMG_5084.jpg",
  "/newactivities/IMG_5086%202.jpg",
  "/newactivities/IMG_5087%202.jpg",
  "/newactivities/IMG_5088%202.jpg",
  "/newactivities/IMG_5090.jpg",
  "/newactivities/IMG_5093.jpg",
  "/newactivities/IMG_5094.jpg",
  "/newactivities/IMG_5096.jpg",
  "/newactivities/IMG_5101.jpg",
  "/newactivities/IMG_5115%202.jpg",
  "/newactivities/IMG_5117.jpg",
  ...Array.from({ length: 20 }, (_, index) => `/image${index + 1}.jpg`),
];

export const DEFAULT_HOMEPAGE_CONTENT = {
  why_spess: {
    eyebrow: "Why choose SPESS?",
    title: "A grounded education for a changing world.",
    intro: "Learners grow through strong academics, purposeful discipline, faith, and a connected school community.",
    cards: [
      { title: "Whole-learner growth", body: "Academic ambition, character, confidence, and service are developed together." },
      { title: "Accessible excellence", body: "A government USE school committed to quality O-Level and A-Level education." },
      { title: "Faith in action", body: "Church of Uganda values shape a caring culture of responsibility and purpose." },
      { title: "Connected community", body: "Families, teachers, and learners stay informed through our digital school platforms." },
    ],
  },
  academic_pathways: {
    eyebrow: "Academic pathways",
    title: "A clear journey from foundation to future.",
    intro: "Our learning pathways support students as they build knowledge, discover strengths, and prepare for their next step.",
    items: [
      {
        label: "O-Level",
        title: "Build a strong foundation",
        body: "A broad secondary education that strengthens core knowledge, study habits, practical skills, and personal responsibility.",
        highlights: ["Government USE access", "Broad subject foundation", "Guided learner development"],
      },
      {
        label: "A-Level",
        title: "Prepare with direction",
        body: "Focused advanced study that helps learners deepen subject mastery and prepare for university, training, and service.",
        highlights: ["Focused subject combinations", "Higher-study preparation", "Leadership and responsibility"],
      },
    ],
  },
  digital_platforms: {
    eyebrow: "Digital campus",
    title: "School life, learning, and progress—connected.",
    intro: "Our digital platforms make essential school services easier to reach for learners, teachers, and families.",
    items: [
      { key: "ark", title: "SPESS ARK", body: "Academic workflows, teacher tools, marks, and school administration in one place.", cta: "Open ARK", href: "/ark" },
      { key: "vine", title: "SPESS Vine", body: "A school community space for communication, learning, news, and participation.", cta: "Enter Vine", href: "/vine/enter" },
      { key: "reports", title: "SPESS Reports", body: "Secure access for families to view learner progress and released school reports.", cta: "View reports", href: "/reports" },
    ],
  },
  headteacher: {
    eyebrow: "A word from school leadership",
    title: "Welcome to St. Phillip’s.",
    name: "The Headteacher",
    role: "Headteacher",
    message: "We believe every learner deserves an education that calls out their ability, strengthens their character, and prepares them to serve with confidence. At St. Phillip’s, academic growth and faith move together in a community where every learner is known and encouraged.",
    image_url: "",
  },
  faqs: [
    { question: "Which academic levels does St. Phillip’s offer?", answer: "The school offers both O-Level and A-Level secondary education." },
    { question: "Is St. Phillip’s a government USE school?", answer: "Yes. St. Phillip’s is a government USE school committed to accessible, quality education." },
    { question: "How can families access learner reports?", answer: "Use SPESS Reports from the homepage. Families can sign in through the secure reports portal when reports are released." },
    { question: "Where can I find current school dates and updates?", answer: "The School Updates section on this homepage shows published news and important dates from the current academic calendar." },
    { question: "How can I contact or visit the school?", answer: "Use the contact section below for the school’s communication channels and campus map." },
  ],
  quick_actions: [
    { key: "ark", label: "ARK", href: "/ark" },
    { key: "vine", label: "Vine", href: "/vine/enter" },
    { key: "reports", label: "Reports", href: "/reports" },
    { key: "contact", label: "Contact", href: "#contact" },
  ],
};

export const DEFAULT_SITE_VISUALS = {
  home_hero_url: "/newhome.jpg",
  boarding_login_url: "/newactivities/covercover.jpeg",
  ark_auth_slides: Array.from({ length: 11 }, (_, index) => `/slide${index + 1}.jpg`),
  activities_banner_url: "/newactivities/cov.jpg",
  contact_hero_url: "/celine.jpg",
  activities_gallery: DEFAULT_ACTIVITY_GALLERY_IMAGES,
  activities_latest_batch: DEFAULT_ACTIVITY_GALLERY_IMAGES.slice(0, 6),
  activities_latest_day: null,
  create_community_enabled: true,
  spess_news_heading: "",
  spess_news_body: "",
  spess_news_posted_on: null,
  spess_news_image_url: "",
  spess_news_published: false,
  homepage_content: DEFAULT_HOMEPAGE_CONTENT,
};

let siteVisualCache = DEFAULT_SITE_VISUALS;
let siteVisualLoadedAt = 0;
let siteVisualInFlight = null;

const cleanHomepageText = (value, fallback = "") =>
  String(value ?? fallback).trim() || String(fallback || "").trim();

export const normalizeHomepageContent = (value = {}) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const defaults = DEFAULT_HOMEPAGE_CONTENT;
  const why = source.why_spess || {};
  const pathways = source.academic_pathways || {};
  const platforms = source.digital_platforms || {};
  const headteacher = source.headteacher || {};
  const whyCards = Array.isArray(why.cards) ? why.cards : [];
  const pathwayItems = Array.isArray(pathways.items) ? pathways.items : [];
  const platformItems = Array.isArray(platforms.items) ? platforms.items : [];
  const faqs = (Array.isArray(source.faqs) ? source.faqs : defaults.faqs)
    .slice(0, 8)
    .map((item, index) => ({
      question: cleanHomepageText(item?.question, defaults.faqs[index]?.question || "Question"),
      answer: cleanHomepageText(item?.answer, defaults.faqs[index]?.answer || "Answer coming soon."),
    }))
    .filter((item) => item.question && item.answer);

  return {
    why_spess: {
      eyebrow: cleanHomepageText(why.eyebrow, defaults.why_spess.eyebrow),
      title: cleanHomepageText(why.title, defaults.why_spess.title),
      intro: cleanHomepageText(why.intro, defaults.why_spess.intro),
      cards: defaults.why_spess.cards.map((fallback, index) => ({
        title: cleanHomepageText(whyCards[index]?.title, fallback.title),
        body: cleanHomepageText(whyCards[index]?.body, fallback.body),
      })),
    },
    academic_pathways: {
      eyebrow: cleanHomepageText(pathways.eyebrow, defaults.academic_pathways.eyebrow),
      title: cleanHomepageText(pathways.title, defaults.academic_pathways.title),
      intro: cleanHomepageText(pathways.intro, defaults.academic_pathways.intro),
      items: defaults.academic_pathways.items.map((fallback, index) => ({
        label: cleanHomepageText(pathwayItems[index]?.label, fallback.label),
        title: cleanHomepageText(pathwayItems[index]?.title, fallback.title),
        body: cleanHomepageText(pathwayItems[index]?.body, fallback.body),
        highlights: (Array.isArray(pathwayItems[index]?.highlights)
          ? pathwayItems[index].highlights
          : fallback.highlights).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 5),
      })),
    },
    digital_platforms: {
      eyebrow: cleanHomepageText(platforms.eyebrow, defaults.digital_platforms.eyebrow),
      title: cleanHomepageText(platforms.title, defaults.digital_platforms.title),
      intro: cleanHomepageText(platforms.intro, defaults.digital_platforms.intro),
      items: defaults.digital_platforms.items.map((fallback, index) => ({
        key: fallback.key,
        title: cleanHomepageText(platformItems[index]?.title, fallback.title),
        body: cleanHomepageText(platformItems[index]?.body, fallback.body),
        cta: cleanHomepageText(platformItems[index]?.cta, fallback.cta),
        href: fallback.href,
      })),
    },
    headteacher: {
      eyebrow: cleanHomepageText(headteacher.eyebrow, defaults.headteacher.eyebrow),
      title: cleanHomepageText(headteacher.title, defaults.headteacher.title),
      name: cleanHomepageText(headteacher.name, defaults.headteacher.name),
      role: cleanHomepageText(headteacher.role, defaults.headteacher.role),
      message: cleanHomepageText(headteacher.message, defaults.headteacher.message),
      image_url: String(headteacher.image_url || "").trim(),
    },
    faqs: faqs.length ? faqs : defaults.faqs,
    quick_actions: defaults.quick_actions.map((fallback, index) => ({
      key: fallback.key,
      label: cleanHomepageText(source.quick_actions?.[index]?.label, fallback.label),
      href: fallback.href,
    })),
  };
};

const normalizeSiteVisuals = (value = {}) => {
  const slides = Array.isArray(value.ark_auth_slides)
    ? value.ark_auth_slides.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12)
    : [];
  const activitiesGallery = Array.isArray(value.activities_gallery)
    ? value.activities_gallery.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const activitiesLatestBatch = Array.isArray(value.activities_latest_batch)
    ? value.activities_latest_batch.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const activitiesLatestDay = String(value.activities_latest_day || "").trim();
  return {
    home_hero_url:
      String(value.home_hero_url || DEFAULT_SITE_VISUALS.home_hero_url).trim() ||
      DEFAULT_SITE_VISUALS.home_hero_url,
    boarding_login_url:
      String(value.boarding_login_url || DEFAULT_SITE_VISUALS.boarding_login_url).trim() ||
      DEFAULT_SITE_VISUALS.boarding_login_url,
    ark_auth_slides: slides.length ? slides : DEFAULT_SITE_VISUALS.ark_auth_slides,
    activities_banner_url:
      String(value.activities_banner_url || DEFAULT_SITE_VISUALS.activities_banner_url).trim() ||
      DEFAULT_SITE_VISUALS.activities_banner_url,
    contact_hero_url:
      String(value.contact_hero_url || DEFAULT_SITE_VISUALS.contact_hero_url).trim() ||
      DEFAULT_SITE_VISUALS.contact_hero_url,
    activities_gallery:
      activitiesGallery.length ? activitiesGallery : DEFAULT_SITE_VISUALS.activities_gallery,
    activities_latest_batch:
      activitiesLatestBatch.length
        ? activitiesLatestBatch
        : (activitiesGallery.length ? activitiesGallery.slice(0, 6) : DEFAULT_SITE_VISUALS.activities_latest_batch),
    activities_latest_day: activitiesLatestDay || null,
    create_community_enabled:
      value.create_community_enabled === undefined || value.create_community_enabled === null
        ? true
        : Number(value.create_community_enabled) === 1 || value.create_community_enabled === true,
    spess_news_heading: String(value.spess_news_heading || "").trim(),
    spess_news_body: String(value.spess_news_body || "").trim(),
    spess_news_posted_on: String(value.spess_news_posted_on || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] || null,
    spess_news_image_url: String(value.spess_news_image_url || "").trim(),
    spess_news_published:
      Number(value.spess_news_published) === 1 || value.spess_news_published === true,
    homepage_content: normalizeHomepageContent(value.homepage_content),
    updated_at: value.updated_at || null,
  };
};

const toRenderableSiteVisuals = (value = {}) => {
  const normalized = normalizeSiteVisuals(value);
  const version = normalized.updated_at || "";
  return {
    ...normalized,
    home_hero_url: withCacheBust(normalized.home_hero_url, version),
    boarding_login_url: withCacheBust(normalized.boarding_login_url, version),
    ark_auth_slides: (normalized.ark_auth_slides || []).map((item) => withCacheBust(item, version)),
    activities_banner_url: withCacheBust(normalized.activities_banner_url, version),
    contact_hero_url: withCacheBust(normalized.contact_hero_url, version),
    spess_news_image_url: withCacheBust(normalized.spess_news_image_url, version),
    homepage_content: {
      ...normalized.homepage_content,
      headteacher: {
        ...normalized.homepage_content.headteacher,
        image_url: withCacheBust(normalized.homepage_content.headteacher.image_url, version),
      },
    },
    activities_gallery: (normalized.activities_gallery || []).map((item) => withCacheBust(item, version)),
    activities_latest_batch: (normalized.activities_latest_batch || []).map((item) => withCacheBust(item, version)),
  };
};

export const fetchSiteVisuals = async ({ force = false } = {}) => {
  if (!force && siteVisualCache && Date.now() - siteVisualLoadedAt < SITE_VISUAL_CACHE_MS) {
    return siteVisualCache;
  }
  if (!force && siteVisualInFlight) {
    return siteVisualInFlight;
  }

  siteVisualInFlight = fetch(`${API}/api/vine/site-visuals/public`, {
    cache: "no-store",
  })
    .then(async (res) => {
      if (!res.ok) throw new Error("Failed to load site visuals");
      const body = await res.json().catch(() => ({}));
      const next = normalizeSiteVisuals(body || {});
      siteVisualCache = next;
      siteVisualLoadedAt = Date.now();
      return next;
    })
    .catch(() => {
      siteVisualCache = DEFAULT_SITE_VISUALS;
      siteVisualLoadedAt = Date.now();
      return DEFAULT_SITE_VISUALS;
    })
    .finally(() => {
      siteVisualInFlight = null;
    });

  return siteVisualInFlight;
};

export const primeSiteVisualsCache = (value = {}) => {
  const next = normalizeSiteVisuals(value || {});
  siteVisualCache = next;
  siteVisualLoadedAt = Date.now();
  return next;
};

export const useSiteVisuals = () => {
  const [visuals, setVisuals] = useState(toRenderableSiteVisuals(siteVisualCache || DEFAULT_SITE_VISUALS));

  useEffect(() => {
    let active = true;
    fetchSiteVisuals().then((next) => {
      if (active) setVisuals(toRenderableSiteVisuals(next));
    });
    return () => {
      active = false;
    };
  }, []);

  return visuals;
};
