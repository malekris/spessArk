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

export const DEFAULT_SITE_VISUALS = {
  home_hero_url: "/newhome.jpg",
  boarding_login_url: "/newactivities/covercover.jpeg",
  ark_auth_slides: Array.from({ length: 11 }, (_, index) => `/slide${index + 1}.jpg`),
  activities_banner_url: "/newactivities/cov.jpg",
  contact_hero_url: "/celine.jpg",
  activities_gallery: DEFAULT_ACTIVITY_GALLERY_IMAGES,
  activities_latest_batch: DEFAULT_ACTIVITY_GALLERY_IMAGES.slice(0, 6),
  activities_latest_day: null,
};

let siteVisualCache = DEFAULT_SITE_VISUALS;
let siteVisualLoadedAt = 0;
let siteVisualInFlight = null;

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
