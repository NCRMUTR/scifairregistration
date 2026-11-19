// Loads everything the public pages need with ONE call: action 'public_site'
//   -> { server_time, settings, logo_url, edition: {…current edition, registration_open, background_url, rules_pdf} | null,
//        years: […], latest_photos: […] }
// The Web App answers in ~1–2 s, so the result is cached briefly: moving between pages does not re-fetch,
// but admin edits show up quickly.
import { api } from './api.js';

const TTL_MS = 30_000;
let cache = null; // { at, promise }

export function loadSite({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = api('public_site', {}, { retry: 1 });
  cache = { at: Date.now(), promise };
  promise.catch(() => {
    if (cache?.promise === promise) cache = null; // never cache a failure
  });
  return promise;
}

/** Call after the admin changes content so the next public page load re-fetches. */
export function invalidateSite() {
  cache = null;
}

/** A text setting (site_settings) with a fallback when missing/empty. */
export function setting(site, key, fallback = '') {
  const value = site?.settings?.[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}
