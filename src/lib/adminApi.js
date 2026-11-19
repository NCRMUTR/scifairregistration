// Admin calls: the session token lives only in sessionStorage (cleared when the tab closes) and in memory.
// An 'unauthorized' reply (expired / logged out elsewhere) clears it and tells the admin page to show the login.
import { api } from './api.js';

export { putToDrive } from './api.js';

const KEY = 'st_admin_session';
let session = null;
let onExpired = () => {};

try {
  session = sessionStorage.getItem(KEY);
} catch {
  /* storage blocked: the session just lives in memory */
}

export const hasSession = () => Boolean(session);
export const setOnExpired = (fn) => {
  onExpired = fn;
};

export function setSession(token) {
  session = token || null;
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export async function adminApi(action, payload = {}, options) {
  try {
    return await api(action, { ...payload, session }, options);
  } catch (err) {
    if (err.reason === 'unauthorized') {
      setSession(null);
      onExpired();
    }
    throw err;
  }
}
