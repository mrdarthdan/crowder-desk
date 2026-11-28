// Shared data layer for Crowder Desk: settings, Supabase auth + REST, Open-Meteo.

export const SUPABASE_URL = 'https://htkbjbfjipbrzidnafrs.supabase.co';
// Publishable (public) key — safe to ship; row-level security decides what it can read.
export const SUPABASE_KEY = 'sb_publishable_XhiTniGMnL449MnIPNAGtw_7Hvi_T9i';
export const KITCHEN_URL = 'https://darthdan.vpages.site/crowder-kitchen/';
export const BLOGPLAN_URL = 'https://darthdan.vpages.site/blog-plan/';
export const PICKET_URL = 'https://darthdan.vpages.site/news-briefing/';

const tauri = window.__TAURI__;
export const inTauri = !!tauri;

/** True in the iPhone/iPad build (and on a phone browser): no tray, no windows, no vault files. */
export const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isMobile) document.documentElement.classList.add('mobile');

/* ---------------- settings ---------------- */

export const DEFAULTS = {
  location: { name: 'Mesa, Arizona', lat: 33.4152, lon: -111.8315 },
  units: 'F',
  windowMode: 'bottom', // bottom | normal | top
  opacity: 0.86,
  show: { weather: true, light: true, shoot: true, note: true, blog: true, jobs: true, recipe: true, news: true },
  order: ['weather', 'light', 'shoot', 'note', 'blog', 'jobs', 'recipe', 'news'],
  jobs: { url: '', key: '' },
  obsidian: {
    vault: 'C:\\Users\\dan\\Documents\\Obsidian\\Dan Crowder',
    target: 'daily', // daily | inbox
    inbox: 'Inbox.md',
    style: 'time', // time ("- 14:05 text") | task ("- [ ] text") | plain ("- text")
  },
  taskCount: 5,
  recipeSections: null, // null = all sections, else array of section ids
  favorFavorites: true,
  newsDesk: 'all', // all | defense | space | tech
};

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('cd.settings') || '{}');
    // Keep the saved order, drop unknown cards, and append any cards added in newer versions.
    const saved = Array.isArray(s.order) ? s.order.filter((k) => DEFAULTS.order.includes(k)) : [];
    const order = [...new Set(saved), ...DEFAULTS.order.filter((k) => !saved.includes(k))];
    return {
      ...DEFAULTS, ...s, order,
      show: { ...DEFAULTS.show, ...(s.show || {}) },
      jobs: { ...DEFAULTS.jobs, ...(s.jobs || {}) },
      obsidian: { ...DEFAULTS.obsidian, ...(s.obsidian || {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}
export function saveSettings(s) {
  // The Job Tracker key lives in Windows Credential Manager, never in settings.
  localStorage.setItem('cd.settings', JSON.stringify({ ...s, jobs: { ...s.jobs, key: '' } }));
}

export const store = {
  get(k, d = null) {
    try { const v = localStorage.getItem('cd.' + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('cd.' + k, JSON.stringify(v)); } catch (e) { console.warn('store', k, e); }
  },
  del(k) { localStorage.removeItem('cd.' + k); },
};

/** Last good data per card, so a failed refresh (or an offline start) still shows something. */
export const cache = {
  get(card) { return store.get('cache.' + card); },
  set(card, key, data) { store.set('cache.' + card, { at: Date.now(), key, data }); },
};

/* ---------------- desktop helpers ---------------- */

export async function openUrl(url) {
  if (!/^(https?|obsidian):\/\//i.test(url)) return;
  if (inTauri) {
    try { await tauri.core.invoke('plugin:opener|open_url', { url }); return; } catch (e) { console.warn(e); }
  }
  window.open(url, '_blank', 'noopener');
}

export function currentWindow() {
  return inTauri ? tauri.window.getCurrentWindow() : null;
}

/* ---------------- secrets ---------------- */
// In the desktop app these live in Windows Credential Manager (via the Rust side).
// In a plain browser (development only) they fall back to localStorage.

const secrets = {};

async function readSecret(name) {
  const raw = inTauri
    ? await tauri.core.invoke('secret_get', { name })
    : localStorage.getItem('cd.secret.' + name);
  return raw ? JSON.parse(raw) : null;
}

export function getSecret(name) { return secrets[name] ?? null; }

export async function setSecret(name, value) {
  secrets[name] = value ?? null;
  if (value == null) {
    if (inTauri) await tauri.core.invoke('secret_delete', { name });
    else localStorage.removeItem('cd.secret.' + name);
  } else {
    const raw = JSON.stringify(value);
    if (inTauri) await tauri.core.invoke('secret_set', { name, value: raw });
    else localStorage.setItem('cd.secret.' + name, raw);
  }
}

/**
 * Loads secrets into memory. Call once before anything signs in or calls the Job Tracker.
 * Also moves secrets that older versions kept in localStorage, deleting the old copy
 * only once the new one is saved. `legacyJobsKey` is the key from saved settings.
 */
export async function initSecrets(legacyJobsKey = '') {
  for (const name of ['session', 'jobs-key']) {
    try { secrets[name] = await readSecret(name); } catch (e) { console.warn('secret', name, e); secrets[name] = null; }
  }
  const old = store.get('session');
  if (old?.refresh_token) {
    try {
      if (!secrets.session) await setSecret('session', { refresh_token: old.refresh_token, email: old.email, user_id: old.user_id });
      store.del('session');
    } catch (e) { console.warn('moving session', e); }
  }
  if (legacyJobsKey && !secrets['jobs-key']) {
    try { await setSecret('jobs-key', legacyJobsKey); } catch (e) { console.warn('moving jobs key', e); }
  }
  // Until the session is restored above, fall back to the old copy so nothing signs out.
  const saved = secrets.session || (old?.refresh_token ? old : null);
  session = saved ? { ...saved, access_token: '', expires_at: 0 } : null;
  sessionAt = saved?.at || 0;
  return { jobsKey: secrets['jobs-key'] || legacyJobsKey || '' };
}

/* ---------------- Supabase auth ---------------- */

// Access tokens stay in memory; only the refresh token, email and user id are saved.
// (On iPhone the session is also in the file shared with the widget; see syncShared.)
let session = null;
let sessionAt = 0; // when the session last changed: sign-in, refresh or sign-out

function saveSessionSecret() {
  if (!session) return setSecret('session', null).catch((e) => console.warn('clearing session', e));
  const { refresh_token, email, user_id } = session;
  return setSecret('session', { refresh_token, email, user_id, at: sessionAt }).catch((e) => console.warn('saving session', e));
}

function readSession() { return session; }
function writeSession(j) {
  session = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000,
    email: j.user?.email || session?.email || '',
    user_id: j.user?.id || session?.user_id || '',
  };
  sessionAt = Date.now();
  saveSessionSecret();
  syncShared();
  return session;
}

export function sessionEmail() { return readSession()?.email || ''; }
export function signedIn() { return !!readSession(); }
export function userId() { return readSession()?.user_id || ''; }

export async function signIn(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'Sign-in failed');
  return writeSession(j);
}

export function signOut() {
  session = null;
  sessionAt = Date.now();
  saveSessionSecret();
  syncShared();
}

let refreshing = null;
async function accessToken() {
  const s = readSession();
  if (!s) return null;
  if (Date.now() < s.expires_at - 60_000) return s.access_token;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        // The widget may have refreshed since; a used refresh token would sign both out.
        await syncShared({ write: false });
        const cur = readSession();
        if (!cur) return null;
        if (Date.now() < cur.expires_at - 60_000) return cur.access_token;
        const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: cur.refresh_token }),
        });
        if (r.status === 400 || r.status === 401) { signOut(); return null; }
        if (!r.ok) return null; // offline or server hiccup: keep the session, try later
        return writeSession(await r.json()).access_token;
      } catch { return null; } finally { refreshing = null; }
    })();
  }
  return refreshing;
}

/* ---------------- data shared with the iPhone widget ---------------- */
// shared.json in the App Group folder: location, units and news desk for the widget, plus
// the Blog Plan session. The widget renews the session when it runs out and writes it back,
// so whichever side changed it last (sessionAt) wins.

let sharedSettings = {};
let sharedGroup; // undefined = not checked yet, null = no App Group
let syncing = Promise.resolve();

/** iPhone only: the App Group the widget data goes to, or null if this install has none. */
export async function sharedGroupName() {
  if (!inTauri || !isMobile) return null;
  if (sharedGroup === undefined) {
    try { sharedGroup = await tauri.core.invoke('shared_group'); } catch { sharedGroup = null; }
  }
  return sharedGroup;
}

export function setSharedSettings(s) {
  sharedSettings = s;
  return syncShared();
}

/** Adopts a newer session from the widget, then (unless write is false) writes ours. */
export function syncShared({ write = true } = {}) {
  if (!inTauri || !isMobile) return Promise.resolve();
  syncing = syncing.then(async () => {
    try {
      if (!(await sharedGroupName())) return;
      const raw = await tauri.core.invoke('shared_read');
      const cur = raw ? JSON.parse(raw) : null;
      if (cur && (cur.sessionAt || 0) > sessionAt) {
        sessionAt = cur.sessionAt;
        session = cur.session?.refresh_token ? { ...cur.session } : null;
        await saveSessionSecret();
      }
      if (!write) return;
      const out = {
        ...(cur || {}), ...sharedSettings,
        session: session ? {
          access_token: session.access_token || '', refresh_token: session.refresh_token,
          expires_at: session.expires_at || 0, email: session.email || '', user_id: session.user_id || '',
        } : null,
        sessionAt, updated: Date.now(),
      };
      await tauri.core.invoke('shared_write', { json: JSON.stringify(out) });
    } catch (e) { console.warn('widget sync', e); }
  });
  return syncing;
}

/** PostgREST call. schema 'plico' uses the profile headers. */
export async function rest(path, { schema = 'public', method = 'GET', body, auth = true, prefer } = {}) {
  const headers = { apikey: SUPABASE_KEY };
  if (auth) {
    const t = await accessToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  if (schema !== 'public') headers[method === 'GET' ? 'Accept-Profile' : 'Content-Profile'] = schema;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const err = new Error(j.message || `Request failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  if (r.status === 204) return null;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

/* ---------------- data sources ---------------- */

export async function fetchWeather(loc, units) {
  const p = new URLSearchParams({
    latitude: loc.lat, longitude: loc.lon,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    temperature_unit: units === 'C' ? 'celsius' : 'fahrenheit',
    wind_speed_unit: units === 'C' ? 'kmh' : 'mph',
    timezone: 'auto', forecast_days: '4',
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
  if (!r.ok) throw new Error('Weather service unavailable');
  return r.json();
}

/** Hourly cloud layers for the Light card (7 days, location's local time). */
export async function fetchSky(loc) {
  const p = new URLSearchParams({
    latitude: loc.lat, longitude: loc.lon,
    hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high',
    timezone: 'auto', forecast_days: '7',
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
  if (!r.ok) throw new Error('Sky forecast unavailable');
  return r.json();
}

/* ---------------- job tracker (Google Apps Script web app) ---------------- */

function jobsEndpoint(cfg, params) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(cfg.url || '')) {
    throw new Error('Job Tracker web app URL isn\'t set');
  }
  const q = new URLSearchParams({ key: cfg.key || '', ...params });
  return `${cfg.url}?${q}`;
}

async function jobsCall(cfg, params) {
  const r = await fetch(jobsEndpoint(cfg, params));
  if (!r.ok) throw new Error(`Job Tracker error (${r.status})`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error === 'unauthorized' ? 'Job Tracker key is wrong' : (j.error || 'Job Tracker error'));
  return j;
}

export async function fetchJobs(cfg) {
  return (await jobsCall(cfg, { action: 'list' })).jobs || [];
}

export function updateJob(cfg, id, patch) {
  return jobsCall(cfg, { action: 'update', id, patch: JSON.stringify(patch) });
}

/* ---------------- Obsidian (via the Rust side) ---------------- */

export function vaultInfo(vault) {
  if (!inTauri) return Promise.reject(new Error('Only available in the desktop app'));
  return tauri.core.invoke('vault_info', { vault });
}

export function appendNote(vault, note, text) {
  if (!inTauri) return Promise.reject(new Error('Only available in the desktop app'));
  return tauri.core.invoke('append_note', { vault, note, text });
}

/** The vault's name: the last part of a folder path, or the name itself on iPhone. */
export function vaultName(vault) {
  return String(vault || '').trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop();
}

/**
 * iPhone: hands the line to the Obsidian app through its obsidian:// link scheme.
 * "daily" uses Obsidian's own Daily notes folder and date format; "inbox" appends to a note.
 * Obsidian comes to the front to write it.
 */
export async function sendNoteToObsidian(vault, target, inbox, text) {
  const q = new URLSearchParams({ vault: vaultName(vault), content: text });
  if (target !== 'daily') q.set('file', String(inbox || 'Inbox.md').replace(/\.md$/i, ''));
  // URLSearchParams writes spaces as "+", which Obsidian keeps literally.
  const params = `${q.toString().replace(/\+/g, '%20')}&append=true&spacing=newline&silent=true`;
  await openUrl(`obsidian://${target === 'daily' ? 'daily' : 'new'}?${params}`);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Formats a date with the moment.js tokens Obsidian uses for daily note names. */
export function momentFormat(fmt, d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const map = {
    YYYY: d.getFullYear(), YY: p(d.getFullYear() % 100),
    MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3), MM: p(d.getMonth() + 1), M: d.getMonth() + 1,
    DD: p(d.getDate()), D: d.getDate(),
    dddd: DAYS[d.getDay()], ddd: DAYS[d.getDay()].slice(0, 3), dd: DAYS[d.getDay()].slice(0, 2),
    HH: p(d.getHours()), H: d.getHours(), mm: p(d.getMinutes()),
  };
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|dd|HH|H|mm/g,
    (m, lit) => (lit !== undefined ? lit : String(map[m])));
}

export async function searchPlaces(q) {
  const p = new URLSearchParams({ name: q, count: '6', language: 'en', format: 'json' });
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${p}`);
  if (!r.ok) throw new Error('Place search failed');
  return (await r.json()).results || [];
}

export function fetchTasks(limit) {
  return rest(
    `blogplan_tasks?select=id,section,title,notes,due,done&done=is.false` +
    `&order=due.asc.nullslast,section_order.asc,sort.asc&limit=${limit}`
  );
}

export function setTaskDone(id, done) {
  return rest(`blogplan_tasks?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: done
      ? { done: true, progress: 100, done_at: new Date().toISOString() }
      : { done: false, progress: 0, done_at: null },
  });
}

export function fetchRecipeIndex() {
  return rest('recipes?select=id,title,section_id,time,serves,description,tags&order=title.asc', { schema: 'plico' });
}
export function fetchSections() {
  return rest('sections?select=id,name&order=sort.asc', { schema: 'plico' });
}
export async function fetchFavorites() {
  if (!signedIn()) return [];
  try {
    const rows = await rest(`favorites?select=recipe_id&user_id=eq.${encodeURIComponent(userId())}`, { schema: 'plico' });
    return rows.map((r) => r.recipe_id);
  } catch { return []; }
}
export async function fetchRecipe(id) {
  const rows = await rest(`recipes?id=eq.${encodeURIComponent(id)}&select=*`, { schema: 'plico' });
  return rows[0] || null;
}

export async function fetchBriefing() {
  const rows = await rest('news_briefings?select=briefing_date,data&order=briefing_date.desc&limit=1', { auth: false });
  return rows[0] || null;
}

/* ---------------- small utils ---------------- */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function localDateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
