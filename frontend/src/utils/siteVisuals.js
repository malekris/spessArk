import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const SITE_VISUAL_CACHE_MS = 60 * 1000;

export const DEFAULT_SITE_VISUALS = {
  home_hero_url: "/newhome.jpg",
  boarding_login_url: "/newactivities/covercover.jpeg",
  ark_auth_slides: Array.from({ length: 11 }, (_, index) => `/slide${index + 1}.jpg`),
};

let siteVisualCache = DEFAULT_SITE_VISUALS;
let siteVisualLoadedAt = 0;
let siteVisualInFlight = null;

const normalizeSiteVisuals = (value = {}) => {
  const slides = Array.isArray(value.ark_auth_slides)
    ? value.ark_auth_slides.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12)
    : [];
  return {
    home_hero_url:
      String(value.home_hero_url || DEFAULT_SITE_VISUALS.home_hero_url).trim() ||
      DEFAULT_SITE_VISUALS.home_hero_url,
    boarding_login_url:
      String(value.boarding_login_url || DEFAULT_SITE_VISUALS.boarding_login_url).trim() ||
      DEFAULT_SITE_VISUALS.boarding_login_url,
    ark_auth_slides: slides.length ? slides : DEFAULT_SITE_VISUALS.ark_auth_slides,
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

export const useSiteVisuals = () => {
  const [visuals, setVisuals] = useState(siteVisualCache || DEFAULT_SITE_VISUALS);

  useEffect(() => {
    let active = true;
    fetchSiteVisuals().then((next) => {
      if (active) setVisuals(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return visuals;
};
