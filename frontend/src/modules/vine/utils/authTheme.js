import { useEffect, useState } from "react";
import { withCacheBust } from "../../../utils/cacheBust";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const AUTH_THEME_CACHE_MS = 60 * 1000;

export const DEFAULT_VINE_AUTH_THEME = {
  cover_url: "/newactivities/fffffffffff.jpg",
  effect_preset: "clean",
  form_alignment: "right",
};

const AUTH_THEME_EFFECTS = ["clean", "cinematic", "floral", "botanical", "dawn", "noir"];
const AUTH_THEME_ALIGNMENTS = ["left", "center", "right"];

let authThemeCache = DEFAULT_VINE_AUTH_THEME;
let authThemeLoadedAt = 0;
let authThemeInFlight = null;

const normalizeVineAuthTheme = (value = {}) => {
  const effect = String(value.effect_preset || "clean").trim().toLowerCase();
  const alignment = String(value.form_alignment || "right").trim().toLowerCase();
  return {
    cover_url: String(value.cover_url || DEFAULT_VINE_AUTH_THEME.cover_url).trim() || DEFAULT_VINE_AUTH_THEME.cover_url,
    effect_preset: AUTH_THEME_EFFECTS.includes(effect) ? effect : "clean",
    form_alignment: AUTH_THEME_ALIGNMENTS.includes(alignment) ? alignment : "right",
    updated_at: value.updated_at || null,
  };
};

const toRenderableVineAuthTheme = (value = {}) => {
  const normalized = normalizeVineAuthTheme(value);
  return {
    ...normalized,
    cover_url: withCacheBust(normalized.cover_url, normalized.updated_at),
  };
};

export const fetchVineAuthTheme = async ({ force = false } = {}) => {
  if (!force && authThemeCache && Date.now() - authThemeLoadedAt < AUTH_THEME_CACHE_MS) {
    return authThemeCache;
  }
  if (!force && authThemeInFlight) {
    return authThemeInFlight;
  }

  authThemeInFlight = fetch(`${API}/api/vine/auth-theme/settings/public`, {
    cache: "no-store",
  })
    .then(async (res) => {
      if (!res.ok) throw new Error("Failed to load auth theme");
      const body = await res.json().catch(() => ({}));
      const next = normalizeVineAuthTheme(body || {});
      authThemeCache = next;
      authThemeLoadedAt = Date.now();
      return next;
    })
    .catch(() => {
      authThemeCache = DEFAULT_VINE_AUTH_THEME;
      authThemeLoadedAt = Date.now();
      return DEFAULT_VINE_AUTH_THEME;
    })
    .finally(() => {
      authThemeInFlight = null;
    });

  return authThemeInFlight;
};

export const primeVineAuthThemeCache = (value = {}) => {
  const next = normalizeVineAuthTheme(value || {});
  authThemeCache = next;
  authThemeLoadedAt = Date.now();
  return next;
};

export const useVineAuthTheme = () => {
  const [theme, setTheme] = useState(toRenderableVineAuthTheme(authThemeCache || DEFAULT_VINE_AUTH_THEME));

  useEffect(() => {
    let active = true;
    fetchVineAuthTheme().then((next) => {
      if (active) setTheme(toRenderableVineAuthTheme(next));
    });
    return () => {
      active = false;
    };
  }, []);

  return theme;
};

export const buildVineAuthThemeClasses = (theme = {}, extra = "") =>
  [
    "vine-auth-bg",
    "vine-auth-bg-login",
    `vine-auth-effect-${normalizeVineAuthTheme(theme).effect_preset}`,
    `vine-auth-align-${normalizeVineAuthTheme(theme).form_alignment}`,
    extra,
  ]
    .filter(Boolean)
    .join(" ");

export const shouldRenderVineAuthFlorals = (theme = {}) =>
  normalizeVineAuthTheme(theme).effect_preset === "floral";
