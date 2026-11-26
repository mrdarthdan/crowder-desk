import {
  inTauri, loadSettings, saveSettings, store, cache, openUrl, currentWindow,
  signIn, signOut, signedIn, sessionEmail, userId, initSecrets, getSecret, setSecret,
  fetchWeather, searchPlaces, fetchTasks, setTaskDone,
  fetchRecipeIndex, fetchSections, fetchFavorites, fetchBriefing,
  fetchSky, fetchJobs, updateJob, vaultInfo, appendNote, momentFormat,
  esc, localDateKey, parseDay, hash,
  KITCHEN_URL, BLOGPLAN_URL, PICKET_URL,
} from './api.js';
import { weatherInfo, ui } from './icons.js';
import { sunTimes, moonIllumination, moonTimes, phaseName, moonSvg, colorOutlook } from './sky.js';
import { fetchShoot, upcoming, verdict, SESSIONS, SHOOT_URL } from './shoot.js';

const JOBTRACKER_URL = 'https://darthdan.vpages.site/job-tracker/';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let settings = loadSettings();
const state = {
  recipes: [], sections: [], favorites: new Set(),
  briefing: null, stories: [], newsIdx: 0,
  sky: null, jobs: null, vault: null, shoot: null,
  last: { weather: 0, light: 0, shoot: 0, blog: 0, jobs: 0, recipe: 0, news: 0 },
  day: localDateKey(),
};

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const MONTHDAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const TODAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/* ================= boot ================= */

function initChrome() {
  $('#btn-refresh').innerHTML = ui.refresh;
  $('#btn-settings').innerHTML = ui.gear;
  $('#btn-hide').innerHTML = ui.hide;
  $('#btn-shuffle').innerHTML = ui.shuffle;
  $('#btn-news-prev').innerHTML = ui.prev;
  $('#btn-news-next').innerHTML = ui.next;
  $('#btn-close-settings').innerHTML = ui.close;

  $('#btn-refresh').addEventListener('click', () => refreshAll(true));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-close-settings').addEventListener('click', closeSettings);
  $('#btn-hide').addEventListener('click', () => {
    const w = currentWindow();
    if (w) w.hide();
  });
  $('#btn-shuffle').addEventListener('click', shuffleRecipe);
  $('#btn-news-prev').addEventListener('click', () => stepNews(-1));
  $('#btn-news-next').addEventListener('click', () => stepNews(1));

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open]');
    if (!t) return;
    const map = { blogplan: BLOGPLAN_URL, kitchen: KITCHEN_URL, picket: PICKET_URL, jobtracker: JOBTRACKER_URL };
    openUrl(map[t.dataset.open] || t.dataset.open);
  });
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('input, textarea')) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#sheet').hidden) closeSettings();
    if (e.key === 'F5') { e.preventDefault(); refreshAll(true); }
  });
  window.addEventListener('focus', tick);
  // Back online (e.g. after sleep or a Wi-Fi drop): refresh whatever is showing saved data.
  window.addEventListener('online', () => {
    for (const k of Object.keys(EVERY)) if ($(`#card-${k}`).classList.contains('stale')) state.last[k] = 0;
    tick();
  });

  if (inTauri) {
    window.__TAURI__.event.listen('tray-action', (e) => {
      if (e.payload === 'refresh') refreshAll(true);
      if (e.payload === 'settings') openSettings();
      if (e.payload === 'raise') raiseWindow();
      if (e.payload === 'note') focusNote();
    });
    // A widget lifted above other windows goes back to its placement once it loses focus.
    window.addEventListener('blur', () => {
      if (!raised) return;
      raised = false;
      applyWindowMode();
    });
  }
}

function applyLook() {
  document.documentElement.style.setProperty('--glass', settings.opacity);
  $('#card-weather').hidden = !settings.show.weather;
  $('#card-light').hidden = !settings.show.light;
  $('#card-shoot').hidden = !settings.show.shoot;
  $('#card-note').hidden = !settings.show.note;
  $('#card-jobs').hidden = !settings.show.jobs;
  $('#card-blog').hidden = !settings.show.blog;
  $('#card-recipe').hidden = !settings.show.recipe;
  $('#card-news').hidden = !settings.show.news;
  $('#today').textContent = TODAY_FMT.format(new Date());
}

async function applyWindowMode() {
  const w = currentWindow();
  if (!w) return;
  try {
    if (settings.windowMode === 'top') {
      await w.setAlwaysOnBottom(false);
      await w.setAlwaysOnTop(true);
    } else if (settings.windowMode === 'bottom') {
      await w.setAlwaysOnTop(false);
      await w.setAlwaysOnBottom(true);
    } else {
      await w.setAlwaysOnTop(false);
      await w.setAlwaysOnBottom(false);
    }
  } catch (e) { console.warn('window mode', e); }
}

// "On desktop" keeps the widget under every window, so showing it from the tray or
// Ctrl+Alt+Space lifts it to the top until you click away.
let raised = false;
async function raiseWindow() {
  const w = currentWindow();
  if (!w || settings.windowMode !== 'bottom') return;
  raised = true;
  try {
    await w.setAlwaysOnBottom(false);
    await w.setAlwaysOnTop(true);
    await w.setFocus();
  } catch (e) { console.warn('raise', e); }
}

function focusNote() {
  if (!$('#sheet').hidden) closeSettings();
  const card = $('#card-note');
  if (card.hidden) return;
  card.scrollIntoView({ block: 'nearest' });
  $('#note-text').focus();
}

/* ================= refresh loop ================= */

async function refreshAll(manual = false) {
  const btn = $('#btn-refresh');
  btn.classList.add('spin');
  const jobs = [];
  if (settings.show.weather) jobs.push(loadWeather());
  if (settings.show.light) jobs.push(loadLight());
  if (settings.show.shoot) jobs.push(loadShoot());
  if (settings.show.jobs) jobs.push(loadJobs());
  if (settings.show.blog) jobs.push(loadBlog());
  if (settings.show.recipe) jobs.push(loadRecipes());
  if (settings.show.news) jobs.push(loadNews());
  await Promise.allSettled(jobs);
  btn.classList.remove('spin');
  $('#foot').textContent = `Updated ${TIME_FMT.format(new Date())}`;
  if (manual) applyLook();
}

const MIN = 60_000;
const EVERY = { weather: 15, light: 30, shoot: 30, jobs: 15, blog: 10, news: 30, recipe: 360 }; // refresh, minutes
const RETRY = 3; // minutes to wait after a failed refresh

function tick() {
  const now = Date.now();
  const today = localDateKey();
  if (today !== state.day) {
    state.day = today;
    applyLook();
    refreshAll();
    return;
  }
  const due = (k) => settings.show[k] && now - state.last[k] > EVERY[k] * MIN;
  if (due('weather')) loadWeather();
  if (due('light')) loadLight();
  else if (settings.show.light) renderLight(); // keep "this evening / tomorrow" current
  if (due('shoot')) loadShoot();
  else if (settings.show.shoot) renderShoot(); // drop sessions that have passed
  if (due('jobs')) loadJobs();
  if (due('blog')) loadBlog();
  if (due('news')) loadNews();
  if (due('recipe')) loadRecipes();
  $('#foot').textContent = `Updated ${TIME_FMT.format(new Date())}`;
}

/* ================= last-good data ================= */

function setStale(card, at) {
  const el = $(`#card-${card}`);
  let note = $('.stale-note', el);
  if (!at) {
    el.classList.remove('stale');
    note?.remove();
    return;
  }
  if (!note) {
    note = document.createElement('div');
    note.className = 'stale-note';
    el.append(note);
  }
  const d = new Date(at);
  const when = localDateKey(d) === localDateKey() ? TIME_FMT.format(d) : `${MONTHDAY.format(d)}, ${TIME_FMT.format(d)}`;
  el.classList.add('stale');
  note.textContent = `Couldn't refresh · showing data from ${when}`;
}

/**
 * Fetches a card's data, saves it as the card's last good copy, and renders it.
 * On failure it renders the saved copy (if it was saved for the same settings, `key`)
 * with a "showing data from …" note, and retries in a few minutes.
 * `onError` can claim an error (return true) to skip all of that.
 */
async function loadCard(card, { key = '', get, render, failMsg, onError }) {
  try {
    const data = await get();
    state.last[card] = Date.now();
    cache.set(card, key, data);
    setStale(card, 0);
    render(data);
  } catch (e) {
    if (onError?.(e)) return;
    state.last[card] = Date.now() - (EVERY[card] - RETRY) * MIN;
    const saved = cache.get(card);
    if (saved && saved.key === key) {
      render(saved.data);
      setStale(card, saved.at);
    } else {
      setStale(card, 0);
      $(`#${card}-body`).innerHTML = `<div class="placeholder">${esc(failMsg(e))} It will retry shortly.</div>`;
    }
  }
}

/* ================= weather ================= */

function clock(isoLocal) {
  // Open-Meteo returns local wall-clock time ("2026-11-21T17:22") for timezone=auto.
  const [h, m] = isoLocal.slice(11, 16).split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return TIME_FMT.format(d);
}

function loadWeather() {
  const { lat, lon } = settings.location;
  return loadCard('weather', {
    key: `${lat},${lon},${settings.units}`,
    get: () => fetchWeather(settings.location, settings.units),
    render: renderWeather,
    failMsg: () => 'Weather unavailable right now.',
  });
}

function renderWeather(w) {
  const el = $('#weather-body');
  const c = w.current, d = w.daily;
  const now = weatherInfo(c.weather_code, c.is_day);
  const afterSunset = c.time > d.sunset[0];
  const sunLine = afterSunset && d.sunrise[1]
    ? `<span>${ui.sunset}Sunrise ${clock(d.sunrise[1])}</span>`
    : `<span class="golden">${ui.sunset}Sunset ${clock(d.sunset[0])}</span>`;
  const windUnit = settings.units === 'C' ? 'km/h' : 'mph';

  const days = [1, 2, 3].map((i) => {
    const info = weatherInfo(d.weather_code[i], 1);
    const p = d.precipitation_probability_max?.[i];
    return `<div class="wx-day" title="${esc(info.label)}">
      <div class="d">${esc(WEEKDAY.format(parseDay(d.time[i])))}</div>
      ${info.icon}
      <div class="t"><b>${Math.round(d.temperature_2m_max[i])}°</b><i>${Math.round(d.temperature_2m_min[i])}°</i></div>
      <div class="p">${p >= 20 ? `${p}% rain` : ''}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="wx-now">
      <div class="wx-temp">${Math.round(c.temperature_2m)}<sup>°${settings.units}</sup></div>
      <div class="wx-big">${now.icon}</div>
      <div class="wx-cond">${esc(now.label)} · H ${Math.round(d.temperature_2m_max[0])}° L ${Math.round(d.temperature_2m_min[0])}°</div>
      <div class="wx-place">${esc(settings.location.name)}</div>
    </div>
    <div class="wx-meta">
      <span>Feels ${Math.round(c.apparent_temperature)}°</span>
      <span>${ui.wind}${Math.round(c.wind_speed_10m)} ${windUnit}</span>
      <span>${ui.drop}${Math.round(c.relative_humidity_2m)}%</span>
      ${sunLine}
    </div>
    <div class="wx-days">${days}</div>`;
  $('.wx-big svg', el)?.setAttribute('style', 'width:64px;height:64px');
}

/* ================= light ================= */

function loadLight() {
  const { lat, lon } = settings.location;
  return loadCard('light', {
    key: `${lat},${lon}`,
    get: () => fetchSky(settings.location),
    render: (sky) => { state.sky = sky; renderLight(); },
    failMsg: () => 'Sky forecast unavailable.',
  });
}

function renderLight() {
  const w = state.sky;
  if (!w) return;
  const { lat, lon } = settings.location;
  const off = w.utc_offset_seconds * 1000;
  const tz = w.timezone;
  const tf = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const wd = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: tz });
  const t = (d) => (d && !isNaN(d) ? tf.format(d) : '—');
  const r = (a, b) => (a && b && !isNaN(a) && !isNaN(b) ? tf.formatRange(a, b) : '—');

  // Calendar day at the location, independent of this PC's clock zone.
  const shifted = new Date(Date.now() + off);
  const Y = shifted.getUTCFullYear(), Mo = shifted.getUTCMonth(), D = shifted.getUTCDate();
  const atLocal = (k, h = 12) => new Date(Date.UTC(Y, Mo, D + k, h) - off);
  const A = [-0.833, 6, -4, -6];
  const today = sunTimes(atLocal(0), lat, lon, A);
  const tomorrow = sunTimes(atLocal(1), lat, lon, A);
  const now = Date.now();

  const morning = now < today[6].rise ? { s: today, label: 'This morning' } : { s: tomorrow, label: 'Tomorrow AM' };
  const evening = now < today[-6].set ? { s: today, label: 'This evening' } : { s: tomorrow, label: 'Tomorrow PM' };
  const mRow = `<div class="k">${morning.label}</div><div class="v">
      <div class="blue">Blue ${r(morning.s[-6].rise, morning.s[-4].rise)}</div>
      <div class="gold">Golden ${r(morning.s[-4].rise, morning.s[6].rise)}</div></div>`;
  const eRow = `<div class="k">${evening.label}</div><div class="v">
      <div class="gold">Golden ${r(evening.s[6].set, evening.s[-4].set)}</div>
      <div class="blue">Blue ${r(evening.s[-4].set, evening.s[-6].set)}</div></div>`;
  const morningFirst = morning.s[6].rise < evening.s[-6].set;

  // Color outlook for the next sunrise or sunset.
  const candidates = [
    { kind: 'sunset', when: today[-0.833].set, day: 'Tonight' },
    { kind: 'sunrise', when: tomorrow[-0.833].rise, day: 'Tomorrow' },
    { kind: 'sunset', when: tomorrow[-0.833].set, day: 'Tomorrow' },
  ];
  if (now < today[-0.833].rise) candidates.unshift({ kind: 'sunrise', when: today[-0.833].rise, day: 'This morning' });
  const ev = candidates.find((c) => c.when > now - 20 * MIN) || candidates[candidates.length - 1];
  const hourKey = new Date(ev.when.valueOf() + off + 30 * MIN).toISOString().slice(0, 13);
  const hi = w.hourly.time.findIndex((x) => x.startsWith(hourKey));
  let outlook = '';
  if (hi >= 0) {
    const H = w.hourly;
    const lo = H.cloud_cover_low[hi], mid = H.cloud_cover_mid[hi], high = H.cloud_cover_high[hi], tot = H.cloud_cover[hi];
    const o = colorOutlook(lo, mid, high, tot);
    outlook = `<div class="outlook">
      <div class="outlook-top"><b>${esc(ev.day)}'s ${ev.kind} · ${t(ev.when)}</b><span>${o.score}</span></div>
      <div class="meter"><i style="width:${o.score}%"></i></div>
      <div>${esc(o.label)}</div>
      <small>Clouds: high ${high}% · mid ${mid}% · low ${lo}%. A rough estimate from the forecast.</small>
    </div>`;
  }

  // Moon now, today's rise/set, and the next full or new moon.
  const ill = moonIllumination(new Date());
  const mt = moonTimes(atLocal(0, 0), lat, lon);
  const riseSet = [['Rises', mt.rise], ['Sets', mt.set]].filter(([, d]) => d).sort((a, b) => a[1] - b[1])
    .map(([k, d]) => `${k} ${t(d)}`).join(' · ') || 'Up all day or down all day';
  let next = '';
  let prev = ill.phase;
  for (let h = 6; h <= 24 * 31; h += 6) {
    const p = moonIllumination(new Date(now + h * 36e5)).phase;
    if (prev < 0.5 && p >= 0.5) { next = `Full moon ${wd.format(new Date(now + h * 36e5))}${h > 24 * 6 ? ' ' + MONTHDAY.format(new Date(now + h * 36e5)) : ''}`; break; }
    if (prev > 0.9 && p < 0.1) { next = `New moon ${wd.format(new Date(now + h * 36e5))}${h > 24 * 6 ? ' ' + MONTHDAY.format(new Date(now + h * 36e5)) : ''}`; break; }
    prev = p;
  }

  // Best night for stars in the forecast: least cloud, least moon (9 PM to 3 AM).
  const H = w.hourly;
  let best = null;
  for (let k = 0; k < 6; k++) {
    const keys = [21, 22, 23].map((h) => new Date(Date.UTC(Y, Mo, D + k, h)).toISOString().slice(0, 13))
      .concat([0, 1, 2, 3].map((h) => new Date(Date.UTC(Y, Mo, D + k + 1, h)).toISOString().slice(0, 13)));
    const vals = keys.map((key) => H.time.findIndex((x) => x.startsWith(key))).filter((i) => i >= 0).map((i) => H.cloud_cover[i]);
    if (vals.length < 4) continue;
    const cloud = vals.reduce((a, b) => a + b, 0) / vals.length;
    const moon = moonIllumination(atLocal(k, 23)).fraction;
    const score = (100 - cloud) * (1 - 0.75 * moon);
    if (!best || score > best.score) best = { k, cloud, moon, score };
  }
  let stars = '';
  if (best && best.cloud <= 60) {
    const day = best.k === 0 ? 'Tonight' : best.k === 1 ? 'Tomorrow' : wd.format(atLocal(best.k));
    stars = `<div class="lt-stars">Best night for stars: <b>${esc(day)}</b> · ${Math.round(best.cloud)}% cloud · moon ${Math.round(best.moon * 100)}%</div>`;
  } else if (best) {
    stars = `<div class="lt-stars">No clear nights in the forecast this week.</div>`;
  }

  $('#light-title').textContent = `Light · ${settings.location.name.split(',')[0]}`;
  $('#light-body').innerHTML = `
    <div class="lt-rows">${morningFirst ? mRow + eRow : eRow + mRow}</div>
    ${outlook}
    <div class="lt-moon">${moonSvg(ill.phase)}
      <div><b>${phaseName(ill.phase)} · ${Math.round(ill.fraction * 100)}%</b>
      <div>${esc(riseSet)}${next ? ` · ${esc(next)}` : ''}</div></div>
    </div>
    ${stars}`;
}

/* ================= shoot planner ================= */

function loadShoot() {
  const body = $('#shoot-body');
  if (!signedIn()) {
    body.innerHTML = `<div class="signin-cta"><span>Sign in to see tonight's best light at your spots.</span>
      <button class="btn primary" id="shoot-signin">Sign in</button></div>`;
    $('#shoot-signin').addEventListener('click', openSettings);
    setStale('shoot', 0);
    return;
  }
  return loadCard('shoot', {
    key: userId(),
    get: fetchShoot,
    render: (data) => { state.shoot = data; renderShoot(); },
    failMsg: () => 'Couldn\'t reach the Shoot Planner.',
    onError: (e) => {
      if (e.status !== 401 && e.status !== 403) return false;
      signOut();
      loadShoot();
      return true;
    },
  });
}

function renderShoot() {
  const data = state.shoot, body = $('#shoot-body');
  if (!data) return;
  if (!data.spots.length) {
    body.innerHTML = `<div class="empty">No spots yet, or this account isn't on the Shoot Planner.</div>`;
    return;
  }
  const bets = upcoming(data);
  const dayWord = (p) => {
    const d = p.window[0], now = new Date();
    if (d.toDateString() === now.toDateString()) return p.session === 'sunrise' ? 'This morning' : 'Tonight';
    return p.session === 'sunrise' ? 'Tomorrow AM' : 'Tomorrow';
  };
  const range = (p) => TIME_FMT.formatRange(p.window[0], p.window[1]);
  let html = '';
  if (bets.length) {
    const b = bets[0], v = verdict(b.score);
    html += `<div class="sp-best">
      <div class="sp-score ${v.cls}">${b.score}<small>${v.label}</small></div>
      <div class="sp-main">
        <b>${esc(b.spot.name)}</b>
        <div class="sp-when">${esc(dayWord(b))} · ${esc(SESSIONS[b.session])} · ${esc(range(b))}</div>
        <div class="sp-why">${esc([b.reasons[0], b.facing].filter(Boolean).join('. '))}</div>
        ${b.warn.length ? `<div class="sp-warn">${esc(b.warn.join(' · '))}</div>` : ''}
      </div>
    </div>`;
    const more = bets.slice(1, 4);
    if (more.length) {
      html += `<ul class="sp-more">${more.map((p) => {
        const v2 = verdict(p.score);
        return `<li><span class="sp-chip ${v2.cls}">${p.score}</span><span class="sp-name">${esc(p.spot.name)}</span><span class="sp-t">${esc(dayWord(p))} · ${esc(SESSIONS[p.session])}</span></li>`;
      }).join('')}</ul>`;
    }
  } else {
    html += `<div class="empty">No forecast for your spots right now.</div>`;
  }
  const o = data.outings[0];
  if (o) {
    const s = data.spots.find((x) => x.id === o.spot_id);
    const packed = o.packing.filter((x) => x.done).length, shots = o.shot_list.length;
    html += `<div class="sp-outing"><span>Next outing</span>
      <b>${esc(s?.name || 'Spot')}</b> · ${esc(WEEKDAY.format(parseDay(o.date)))} ${esc(SESSIONS[o.session] || o.session)}
      <small>Packed ${packed}/${o.packing.length}${shots ? ` · ${shots} shot${shots === 1 ? '' : 's'} planned` : ''}</small></div>`;
  }
  body.innerHTML = html;
}

/* ================= quick note (Obsidian) ================= */

async function currentVault() {
  if (state.vault && state.vault.path === settings.obsidian.vault) return state.vault.info;
  const info = await vaultInfo(settings.obsidian.vault);
  state.vault = { path: settings.obsidian.vault, info };
  return info;
}

function noteLine(text) {
  const now = new Date();
  const [first, ...rest] = text.split(/\r?\n/);
  const style = settings.obsidian.style;
  const head = style === 'task' ? `- [ ] ${first}`
    : style === 'time' ? `- ${momentFormat('HH:mm', now)} ${first}`
    : `- ${first}`;
  return [head, ...rest.map((l) => `  ${l}`)].join('\n');
}

function syncNoteTarget() {
  $$('#note-target button').forEach((b) => b.classList.toggle('on', b.dataset.value === settings.obsidian.target));
}

async function addNote() {
  const box = $('#note-text');
  const status = $('#note-status');
  const text = box.value.trim();
  if (!text) return;
  status.className = 'note-status';
  status.textContent = 'Adding…';
  try {
    const info = await currentVault();
    let note;
    if (settings.obsidian.target === 'daily') {
      const name = momentFormat(info.daily_format || 'YYYY-MM-DD');
      note = info.daily_folder ? `${info.daily_folder}/${name}` : name;
    } else {
      note = settings.obsidian.inbox || 'Inbox.md';
    }
    const rel = await appendNote(settings.obsidian.vault, note, noteLine(text));
    box.value = '';
    autosize(box);
    status.className = 'note-status ok';
    status.innerHTML = `Added to ${esc(rel)}<button id="note-open">Open in Obsidian</button>`;
    $('#note-open').addEventListener('click', () => openUrl(
      `obsidian://open?vault=${encodeURIComponent(info.name)}&file=${encodeURIComponent(rel.replace(/\.md$/i, ''))}`));
  } catch (e) {
    status.className = 'note-status err';
    status.textContent = String(e?.message || e);
  }
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight + 2, 120)}px`;
}

function initNote() {
  syncNoteTarget();
  $('#note-target').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.obsidian.target = b.dataset.value;
    persist();
    syncNoteTarget();
  });
  const box = $('#note-text');
  box.addEventListener('input', () => autosize(box));
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); }
  });
  $('#note-add').addEventListener('click', addNote);
}

/* ================= job search ================= */

const dayDiff = (a, b) => Math.round((parseDay(a) - parseDay(b)) / 86_400_000);
function dropDay(found) {
  const d = parseDay(found);
  return localDateKey(new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()));
}
function isDropped(j, today) {
  return !j.applied && j.found && today > dropDay(j.found) && !(j.notes || '').includes('[Kept open');
}

async function loadJobs() {
  const body = $('#jobs-body');
  const cfg = settings.jobs;
  if (!cfg.url || !cfg.key) {
    body.innerHTML = `<div class="signin-cta"><span>Connect your Job Tracker to see what needs you today.</span>
      <button class="btn primary" id="jobs-connect">Connect</button></div>`;
    $('#jobs-connect').addEventListener('click', openSettings);
    setStale('jobs', 0);
    return;
  }
  return loadCard('jobs', {
    key: cfg.url,
    get: () => fetchJobs(cfg),
    render: (jobs) => { state.jobs = jobs; renderJobs(); },
    failMsg: (e) => `${e.message || 'Couldn\'t reach the Job Tracker'}.`,
  });
}

function renderJobs() {
  const body = $('#jobs-body');
  const today = localDateKey();
  const open = (state.jobs || []).filter((j) => !j.closed && !isDropped(j, today));
  const starred = open.filter((j) => j.starred);
  const fresh = open.filter((j) => j.found && dayDiff(today, j.found) <= 7);
  const applied = open.filter((j) => j.applied);

  const apply = starred.filter((j) => !j.applied)
    .sort((a, b) => (a.found || '').localeCompare(b.found || ''))
    .slice(0, 4);

  // "Followed up" snoozes are kept on this PC: { [jobId]: { until, stage } }.
  // A snooze only holds while the req stays in the same stage.
  const snoozes = store.get('jobSnooze', {});
  const follow = [];
  for (const j of applied) {
    let f = null;
    if (j.interviewed) {
      const n = dayDiff(today, j.interviewed);
      f = { j, n, stage: 'interviewed', note: n <= 7 ? `Interviewed ${n}d ago · send a thank-you` : `Interviewed ${n}d ago · ask about next steps` };
    } else if (j.callback) {
      f = { j, n: dayDiff(today, j.callback), stage: 'callback', note: 'Callback · set up the interview' };
    } else {
      const n = dayDiff(today, j.applied);
      if (n >= 7) f = { j, n, stage: 'applied', note: `Applied ${n}d ago · follow up` };
    }
    const s = f && snoozes[j.id];
    if (f && !(s && s.stage === f.stage && today < s.until)) follow.push(f);
  }
  follow.sort((a, b) => b.n - a.n);

  const item = (j, side, sub) => `<div class="jb" data-id="${esc(j.id)}">
      <div class="t" data-url="${esc(j.url || '')}">${j.starred ? '<span class="star">★</span>' : ''}${esc(j.title)}</div>
      <div class="side">${side}</div>
      <div class="c">${esc(sub)}</div>
    </div>`;

  const applyHtml = apply.map((j) => {
    const left = dayDiff(dropDay(j.found), today);
    const chip = left <= 7
      ? `<span class="due ${left <= 2 ? 'late' : 'soon'}">${left <= 0 ? 'drops today' : left === 1 ? 'drops tomorrow' : `drops in ${left}d`}</span>`
      : '';
    return item(j, `${chip}<button class="mini-btn" data-applied="${esc(j.id)}">Applied</button>`,
      [j.company, j.pay && j.pay !== 'Not listed' ? j.pay : ''].filter(Boolean).join(' · '));
  }).join('');
  const followHtml = follow.slice(0, 3).map(({ j, note, stage }) => item(j,
    `<button class="mini-btn" data-followed="${esc(j.id)}" data-stage="${stage}" title="Hide for 7 days">Followed up</button>`,
    `${j.company} · ${note}`)).join('');

  body.innerHTML = `
    <div class="jb-stats">
      <span><b>${open.length}</b>open</span><span><b>${starred.length}</b>starred</span>
      <span><b>${fresh.length}</b>new this week</span><span><b>${applied.length}</b>applied</span>
    </div>
    ${applyHtml ? `<div class="jb-group">Apply today</div>${applyHtml}` : ''}
    ${followHtml ? `<div class="jb-group">Follow up</div>${followHtml}` : ''}
    ${!applyHtml && !followHtml ? '<div class="empty">Nothing needs you today. Star a req in the tracker to see it here.</div>' : ''}`;

  $$('.jb .t', body).forEach((el) => el.addEventListener('click', () => el.dataset.url && openUrl(el.dataset.url)));
  $$('[data-applied]', body).forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    b.textContent = 'Saving…';
    try {
      await updateJob(settings.jobs, b.dataset.applied, { applied: localDateKey() });
      const j = state.jobs.find((x) => x.id === b.dataset.applied);
      if (j) j.applied = localDateKey();
      renderJobs();
    } catch (e) {
      b.disabled = false;
      b.textContent = 'Retry';
      b.title = e.message;
    }
  }));
  $$('[data-followed]', body).forEach((b) => b.addEventListener('click', () => {
    const snz = store.get('jobSnooze', {});
    const t = localDateKey();
    for (const [id, s] of Object.entries(snz)) if (s.until <= t) delete snz[id]; // drop expired
    const d = parseDay(t);
    snz[b.dataset.followed] = {
      stage: b.dataset.stage,
      until: localDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)),
    };
    store.set('jobSnooze', snz);
    renderJobs();
  }));
}

/* ================= blog plan ================= */

function dueChip(due) {
  if (!due) return '';
  const today = parseDay(localDateKey());
  const dd = parseDay(due);
  const diff = Math.round((dd - today) / 86_400_000);
  if (diff < 0) return `<span class="due late">${diff === -1 ? 'Yesterday' : `${-diff}d late`}</span>`;
  if (diff === 0) return `<span class="due today">Today</span>`;
  if (diff === 1) return `<span class="due soon">Tomorrow</span>`;
  if (diff < 7) return `<span class="due ${diff <= 3 ? 'soon' : ''}">${esc(WEEKDAY.format(dd))}</span>`;
  return `<span class="due">${esc(MONTHDAY.format(dd))}</span>`;
}

const check = `<svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-5"/></svg>`;

async function loadBlog() {
  const body = $('#blog-body');
  if (!signedIn()) {
    body.innerHTML = `<div class="signin-cta"><span>Sign in to see your next posting tasks.</span>
      <button class="btn primary" id="blog-signin">Sign in</button></div>`;
    $('#blog-signin').addEventListener('click', openSettings);
    setStale('blog', 0);
    return;
  }
  return loadCard('blog', {
    key: `${userId()}:${settings.taskCount}`,
    get: () => fetchTasks(settings.taskCount),
    render: renderTasks,
    failMsg: () => 'Couldn\'t reach Blog Plan.',
    onError: (e) => {
      if (e.status !== 401 && e.status !== 403) return false;
      signOut();
      loadBlog();
      return true;
    },
  });
}

function renderTasks(tasks) {
  const body = $('#blog-body');
  if (!tasks.length) {
    body.innerHTML = `<div class="empty">Every task is checked off. Nice work.</div>`;
    return;
  }
  let lastSection = null;
  const parts = [];
  for (const t of tasks) {
    if (t.section !== lastSection) {
      parts.push(`<li class="week" title="${esc(t.section)}">${esc(t.section || 'Unsorted')}</li>`);
      lastSection = t.section;
    }
    parts.push(`<li class="task" data-id="${esc(t.id)}">
      <button class="box" title="Mark done">${check}</button>
      <div><div class="title">${esc(t.title)}</div>${t.notes ? `<div class="note" title="${esc(t.notes)}">${esc(t.notes)}</div>` : ''}</div>
      ${dueChip(t.due)}
    </li>`);
  }
  body.innerHTML = `<ul class="tasks">${parts.join('')}</ul>`;
  $$('.task .box', body).forEach((b) => b.addEventListener('click', toggleTask));
}

let blogReload;
async function toggleTask(e) {
  const li = e.currentTarget.closest('.task');
  const done = !li.classList.contains('done');
  li.classList.toggle('done', done);
  try {
    await setTaskDone(li.dataset.id, done);
  } catch {
    li.classList.toggle('done', !done);
    return;
  }
  clearTimeout(blogReload);
  blogReload = setTimeout(loadBlog, 2500); // leave time to undo a mis-click
}

/* ================= recipe of the day ================= */

function loadRecipes() {
  return loadCard('recipe', {
    key: userId(), // favorites depend on who is signed in
    get: async () => {
      const [recipes, sections, favs] = await Promise.all([fetchRecipeIndex(), fetchSections(), fetchFavorites()]);
      return { recipes, sections, favs };
    },
    render: ({ recipes, sections, favs }) => {
      state.recipes = recipes;
      state.sections = sections;
      state.favorites = new Set(favs);
      renderRecipe();
    },
    failMsg: () => 'Couldn\'t reach Crowder Kitchen.',
  });
}

function recipePool() {
  const allow = settings.recipeSections ? new Set(settings.recipeSections) : null;
  const pool = [];
  for (const r of state.recipes) {
    if (allow && !allow.has(r.section_id)) continue;
    pool.push(r);
    if (settings.favorFavorites && state.favorites.has(r.id)) pool.push(r, r); // 3x weight
  }
  return pool;
}

const NO_REPEAT_DAYS = 14;

/** Recipes shown on earlier days within the no-repeat window ({ 'YYYY-MM-DD': id }). */
function recentRecipeIds(today) {
  const hist = store.get('recipeHistory', {});
  return new Set(Object.entries(hist)
    .filter(([d]) => d !== today && dayDiff(today, d) <= NO_REPEAT_DAYS)
    .map(([, id]) => id));
}

function rememberRecipe(today, id) {
  const hist = store.get('recipeHistory', {});
  if (hist[today] === id) return;
  hist[today] = id;
  for (const d of Object.keys(hist)) if (dayDiff(today, d) > NO_REPEAT_DAYS) delete hist[d];
  store.set('recipeHistory', hist);
}

function pickRecipe() {
  const all = recipePool();
  if (!all.length) return null;
  const today = localDateKey();
  const recent = recentRecipeIds(today);
  const fresh = all.filter((r) => !recent.has(r.id));
  const pool = fresh.length ? fresh : all; // small filters: allow repeats rather than nothing
  const sh = store.get('shuffle');
  const n = sh && sh.date === today ? sh.n : 0;
  return pool[hash(`${today}:${n}`) % pool.length];
}

function shuffleRecipe() {
  const today = localDateKey();
  const before = pickRecipe();
  const sh = store.get('shuffle');
  let n = sh && sh.date === today ? sh.n : 0;
  for (let i = 0; i < 12; i++) {
    n++;
    store.set('shuffle', { date: today, n });
    if (pickRecipe()?.id !== before?.id) break;
  }
  renderRecipe();
}

function renderRecipe() {
  const body = $('#recipe-body');
  const r = pickRecipe();
  if (!r) {
    body.innerHTML = `<div class="empty">No recipes match your section filter.</div>`;
    return;
  }
  rememberRecipe(localDateKey(), r.id);
  const section = state.sections.find((s) => s.id === r.section_id)?.name || '';
  const meta = [r.time, r.serves ? `Serves ${r.serves}` : ''].filter(Boolean);
  body.innerHTML = `
    <div class="rc-section">${esc(section)}</div>
    <div class="rc-title" id="rc-open">${esc(r.title)}</div>
    <div class="rc-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}
      ${state.favorites.has(r.id) ? '<span class="rc-fav">★ Favorite</span>' : ''}</div>
    ${r.description ? `<p class="rc-desc">${esc(r.description)}</p>` : ''}
    <div class="rc-actions">
      <button class="btn primary" id="rc-view">View recipe</button>
      <button class="btn" data-open="kitchen">${ui.ext}Crowder Kitchen</button>
    </div>`;
  const open = () => openRecipe(r.id);
  $('#rc-open').addEventListener('click', open);
  $('#rc-view').addEventListener('click', open);
}

async function openRecipe(id) {
  if (inTauri) {
    try { await window.__TAURI__.core.invoke('open_recipe', { id }); return; } catch (e) { console.warn(e); }
  }
  window.open(`recipe.html?id=${encodeURIComponent(id)}`, 'recipe', 'width=560,height=780');
}

/* ================= news ================= */

const DESKS = ['defense', 'space', 'tech'];

function buildStories() {
  const desks = state.briefing?.data?.desks || {};
  const want = settings.newsDesk === 'all' ? DESKS : [settings.newsDesk];
  state.stories = want.flatMap((k) => (desks[k] || []).map((s) => ({ ...s, desk: k })));
  const saved = store.get('news');
  const date = state.briefing?.briefing_date;
  state.newsIdx = saved && saved.date === date && saved.desk === settings.newsDesk ? saved.idx : 0;
  if (state.newsIdx >= state.stories.length) state.newsIdx = 0;
}

function loadNews() {
  return loadCard('news', {
    get: fetchBriefing,
    render: (b) => { state.briefing = b; buildStories(); renderNews(); },
    failMsg: () => 'Couldn\'t reach Picket Station.',
  });
}

function stepNews(dir) {
  const n = state.stories.length;
  if (!n) return;
  state.newsIdx = (state.newsIdx + dir + n) % n;
  store.set('news', { date: state.briefing.briefing_date, desk: settings.newsDesk, idx: state.newsIdx });
  renderNews();
}

function renderNews() {
  const body = $('#news-body');
  const b = state.briefing;
  if (!b) { body.innerHTML = `<div class="empty">No briefing yet.</div>`; return; }
  const date = parseDay(b.briefing_date);
  const isToday = b.briefing_date === localDateKey();
  $('#news-title').textContent = `Picket Station · ${MONTHDAY.format(date)}${isToday ? '' : ' (latest)'}`;
  const n = state.stories.length;
  $('#news-count').textContent = n ? `${state.newsIdx + 1}/${n}` : '';
  if (!n) { body.innerHTML = `<div class="empty">No stories on this desk today.</div>`; return; }

  const s = state.stories[state.newsIdx];
  const img = typeof s.image === 'string' && s.image.startsWith('https://') ? s.image : '';
  const links = (s.links || []).filter((l) => /^https?:\/\//.test(l.url));
  body.innerHTML = `
    <div class="nw ${img ? '' : 'noimg'}">
      <div>
        <span class="nw-desk ${esc(s.desk)}">${esc(s.desk)}${s.topic ? ` · ${esc(s.topic)}` : ''}</span>
        <div class="nw-head">${esc(s.headline)}</div>
      </div>
      ${img ? `<img class="nw-img" alt="" referrerpolicy="no-referrer" src="${esc(img)}" />` : ''}
    </div>
    <p class="nw-sum">${esc(s.summary)}</p>
    <div class="nw-links">
      ${links.map((l, i) => `<button class="btn" data-link="${i}">${ui.ext}${esc(l.label || 'Source')}</button>`).join('')}
      <button class="btn" data-open="picket">${ui.ext}Full briefing</button>
    </div>`;
  $$('[data-link]', body).forEach((btn) =>
    btn.addEventListener('click', () => openUrl(links[+btn.dataset.link].url)));
  const im = $('.nw-img', body);
  if (im) im.addEventListener('error', () => { im.remove(); $('.nw', body).classList.add('noimg'); });
}

/* ================= settings ================= */

function syncSegments() {
  $$('.seg[data-setting]').forEach((seg) => {
    const key = seg.dataset.setting;
    $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.value === settings[key]));
  });
}

function renderAccount() {
  const inn = signedIn();
  $('#acct-in').hidden = !inn;
  $('#acct-out').hidden = inn;
  $('#acct-email').textContent = sessionEmail();
  $('#signin-err').textContent = '';
}

function renderSectionChecks() {
  const wrap = $('#set-sections');
  if (!state.sections.length) { wrap.innerHTML = '<span class="hint">Sections load with the recipes.</span>'; return; }
  const allow = settings.recipeSections ? new Set(settings.recipeSections) : null;
  wrap.innerHTML = state.sections.map((s) =>
    `<label class="check"><input type="checkbox" value="${s.id}" ${!allow || allow.has(s.id) ? 'checked' : ''}/> ${esc(s.name)}</label>`
  ).join('');
}

async function openSettings() {
  syncSegments();
  renderAccount();
  renderSectionChecks();
  $('#set-place-current').textContent = `Current: ${settings.location.name}`;
  $('#place-results').innerHTML = '';
  $('#set-taskcount').value = String(settings.taskCount);
  $('#set-favs').checked = settings.favorFavorites;
  $('#set-opacity').value = settings.opacity;
  renderOrderList();
  $('#set-jobs-url').value = settings.jobs.url;
  $('#set-jobs-key').value = settings.jobs.key;
  $('#jobs-msg').textContent = '';
  $('#set-vault').value = settings.obsidian.vault;
  $('#set-inbox').value = settings.obsidian.inbox;
  $('#vault-msg').textContent = '';
  $$('#set-note-style button').forEach((b) => b.classList.toggle('on', b.dataset.value === settings.obsidian.style));
  $('#sheet').hidden = false;
  if (inTauri) {
    try { $('#set-autostart').checked = await window.__TAURI__.core.invoke('plugin:autostart|is_enabled'); }
    catch { $('#set-autostart').disabled = true; }
  } else {
    $('#set-autostart').disabled = true;
  }
}

function closeSettings() { $('#sheet').hidden = true; }

function persist() { saveSettings(settings); }

function initSettings() {
  $$('.seg[data-setting]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const key = seg.dataset.setting;
      if (settings[key] === b.dataset.value) return;
      settings[key] = b.dataset.value;
      persist();
      syncSegments();
      if (key === 'units') loadWeather();
      if (key === 'newsDesk') { buildStories(); renderNews(); }
      if (key === 'windowMode') applyWindowMode();
    });
  });

  const doSearch = async () => {
    const q = $('#set-place').value.trim();
    const out = $('#place-results');
    if (!q) return;
    out.innerHTML = '<span class="hint">Searching…</span>';
    try {
      const res = await searchPlaces(q);
      if (!res.length) { out.innerHTML = '<span class="hint">No matches.</span>'; return; }
      out.innerHTML = res.map((r, i) =>
        `<button data-i="${i}">${esc(r.name)}${r.admin1 ? `, ${esc(r.admin1)}` : ''} · ${esc(r.country_code || r.country || '')}</button>`
      ).join('');
      $$('button', out).forEach((b) => b.addEventListener('click', () => {
        const r = res[+b.dataset.i];
        settings.location = { name: `${r.name}${r.admin1 ? `, ${r.admin1}` : ''}`, lat: r.latitude, lon: r.longitude };
        persist();
        $('#set-place-current').textContent = `Current: ${settings.location.name}`;
        out.innerHTML = '';
        $('#set-place').value = '';
        loadWeather();
        loadLight();
      }));
    } catch { out.innerHTML = '<span class="err">Search failed.</span>'; }
  };
  $('#btn-place-search').addEventListener('click', doSearch);
  $('#set-place').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  $('#btn-signin').addEventListener('click', async () => {
    const email = $('#set-email').value.trim();
    const pass = $('#set-pass').value;
    const err = $('#signin-err');
    if (!email || !pass) { err.textContent = 'Enter your email and password.'; return; }
    err.textContent = 'Signing in…';
    try {
      await signIn(email, pass);
      $('#set-pass').value = '';
      renderAccount();
      loadBlog();
      loadShoot();
      loadRecipes(); // picks up favorites
    } catch (e) { err.textContent = e.message; }
  });
  $('#set-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-signin').click(); });
  $('#btn-signout').addEventListener('click', () => {
    signOut();
    state.favorites = new Set();
    renderAccount();
    loadBlog();
    loadShoot();
    renderRecipe();
  });

  $('#btn-jobs-save').addEventListener('click', async () => {
    const msg = $('#jobs-msg');
    settings.jobs = { url: $('#set-jobs-url').value.trim(), key: $('#set-jobs-key').value.trim() };
    persist();
    msg.className = 'hint';
    msg.textContent = 'Testing…';
    try {
      await setSecret('jobs-key', settings.jobs.key || null);
      const jobs = await fetchJobs(settings.jobs);
      msg.className = 'hint';
      msg.textContent = `Connected: ${jobs.length} reqs in your tracker.`;
      state.jobs = jobs;
      state.last.jobs = Date.now();
      cache.set('jobs', settings.jobs.url, jobs);
      setStale('jobs', 0);
      renderJobs();
    } catch (e) {
      msg.className = 'err';
      msg.textContent = e.message;
    }
  });

  const checkVault = async () => {
    const msg = $('#vault-msg');
    settings.obsidian.vault = $('#set-vault').value.trim();
    persist();
    state.vault = null;
    try {
      const info = await currentVault();
      const where = `${info.daily_folder ? info.daily_folder + '/' : ''}${info.daily_format}.md`;
      msg.className = '';
      msg.textContent = `Vault "${info.name}" found. Daily notes go to ${where}.`;
    } catch (e) {
      msg.className = 'err';
      msg.textContent = String(e?.message || e);
    }
  };
  $('#btn-vault-check').addEventListener('click', checkVault);
  $('#set-vault').addEventListener('change', checkVault);
  $('#set-inbox').addEventListener('change', (e) => {
    settings.obsidian.inbox = e.target.value.trim() || 'Inbox.md';
    persist();
  });
  $('#set-note-style').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.obsidian.style = b.dataset.value;
    persist();
    $$('#set-note-style button').forEach((x) => x.classList.toggle('on', x === b));
  });

  $('#set-taskcount').addEventListener('change', (e) => {
    settings.taskCount = +e.target.value; persist(); loadBlog();
  });
  $('#set-sections').addEventListener('change', () => {
    const boxes = $$('#set-sections input');
    const ids = boxes.filter((b) => b.checked).map((b) => +b.value);
    settings.recipeSections = ids.length === boxes.length ? null : ids;
    persist(); renderRecipe();
  });
  $('#set-favs').addEventListener('change', (e) => {
    settings.favorFavorites = e.target.checked; persist(); renderRecipe();
  });
  $('#set-opacity').addEventListener('input', (e) => {
    settings.opacity = +e.target.value; persist(); applyLook();
  });
  $('#order-list').addEventListener('change', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    settings.show[li.dataset.k] = e.target.checked;
    persist();
    applyLook();
    if (e.target.checked) refreshAll();
  });
  $('#order-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-move]');
    if (!b) return;
    const k = b.closest('li').dataset.k;
    const i = settings.order.indexOf(k), j = i + Number(b.dataset.move);
    if (j < 0 || j >= settings.order.length) return;
    [settings.order[i], settings.order[j]] = [settings.order[j], settings.order[i]];
    persist();
    applyOrder();
    renderOrderList();
    $(`#order-list li[data-k="${k}"] [data-move="${b.dataset.move}"]`)?.focus();
  });
  $('#set-autostart').addEventListener('change', async (e) => {
    if (!inTauri) return;
    try {
      await window.__TAURI__.core.invoke(e.target.checked ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
    } catch (err) {
      console.warn(err);
      e.target.checked = !e.target.checked;
    }
  });
}

/* ================= card order ================= */

const CARD_NAMES = {
  weather: 'Weather', light: 'Light', shoot: 'Shoot Planner', note: 'Quick note', blog: 'Blog Plan',
  jobs: 'Job search', recipe: "Today's recipe", news: 'Picket Station',
};

function applyOrder() {
  const main = $('#main'), foot = $('#foot');
  for (const k of settings.order) main.insertBefore($(`#card-${k}`), foot);
}

function renderOrderList() {
  const n = settings.order.length;
  $('#order-list').innerHTML = settings.order.map((k, i) => `
    <li data-k="${k}">
      <label class="check"><input type="checkbox" ${settings.show[k] ? 'checked' : ''} /> ${esc(CARD_NAMES[k])}</label>
      <span class="arrows">
        <button class="icon-btn small" data-move="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>${ui.up}</button>
        <button class="icon-btn small" data-move="1" title="Move down" ${i === n - 1 ? 'disabled' : ''}>${ui.down}</button>
      </span>
    </li>`).join('');
}

function saveOrderFromDom() {
  settings.order = $$('#main > .card').map((c) => c.dataset.card);
  persist();
}

// Pointer-based dragging (HTML5 drag-and-drop is taken over by the window's file-drop handling on Windows).
function initDrag() {
  for (const k of settings.order) {
    const card = $(`#card-${k}`);
    card.dataset.card = k;
    const grip = document.createElement('button');
    grip.className = 'grip';
    grip.title = 'Drag to reorder';
    grip.setAttribute('aria-label', `Reorder ${CARD_NAMES[k]}`);
    grip.innerHTML = ui.grip;
    card.prepend(grip);
    grip.addEventListener('pointerdown', startDrag);
  }
}

function startDrag(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  const grip = e.currentTarget;
  const card = grip.closest('.card');
  const main = $('#main');
  card.classList.add('dragging');
  document.body.classList.add('reordering');
  let y = e.clientY;

  const placeAt = () => {
    const others = $$('#main > .card:not([hidden])').filter((c) => c !== card);
    const before = others.find((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    const ref = before || $('#foot');
    if (card.nextElementSibling !== ref) main.insertBefore(card, ref);
  };
  const move = (ev) => { y = ev.clientY; placeAt(); };
  // Scroll the card list when dragging near its top or bottom edge.
  const scroller = setInterval(() => {
    const r = main.getBoundingClientRect();
    if (y < r.top + 36) main.scrollTop -= 14;
    else if (y > r.bottom - 36) main.scrollTop += 14;
    else return;
    placeAt();
  }, 30);
  const end = () => {
    clearInterval(scroller);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('blur', end);
    card.classList.remove('dragging');
    document.body.classList.remove('reordering');
    saveOrderFromDom();
  };
  // Listen on the window: moving the card in the page would drop a capture held by its handle.
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);
}

/* ================= updates ================= */

async function checkUpdate(manual = false) {
  if (!inTauri) return;
  const msg = $('#update-msg');
  if (manual) msg.textContent = 'Checking…';
  try {
    const v = await window.__TAURI__.core.invoke('check_update');
    if (v) showUpdate(v);
    if (manual) msg.textContent = v ? `Version ${v} is available.` : 'You have the latest version.';
  } catch (e) {
    if (manual) msg.textContent = `Couldn't check for updates: ${e?.message || e}`;
    else console.warn('update check', e);
  }
}

function showUpdate(version) {
  const bar = $('#update');
  bar.innerHTML = `<span>Crowder Desk ${esc(version)} is ready</span>
    <button class="btn primary" id="btn-update">Install and restart</button>`;
  bar.hidden = false;
  const btn = $('#btn-update');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Installing…';
    try {
      await window.__TAURI__.core.invoke('install_update'); // restarts the app when done
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Retry';
      btn.title = String(e?.message || e);
    }
  });
}

function initUpdates() {
  $('#btn-update-check').addEventListener('click', () => checkUpdate(true));
  if (!inTauri) { $('#btn-update-check').disabled = true; return; }
  window.__TAURI__.app.getVersion().then((v) => { $('#app-version').textContent = `Crowder Desk ${v}`; }).catch(() => {});
  setTimeout(checkUpdate, 30_000); // give the network a moment after Windows starts
  setInterval(checkUpdate, 6 * 60 * MIN);
}

/* ================= go ================= */

// Secrets first: the Blog Plan session and Job Tracker key come from Credential Manager.
{
  const { jobsKey } = await initSecrets(settings.jobs.key);
  settings.jobs.key = jobsKey;
  if (getSecret('jobs-key')) persist(); // the key is stored safely; drop any old copy in settings
}
initChrome();
initSettings();
initNote();
initDrag();
initUpdates();
applyOrder();
applyLook();
applyWindowMode();
refreshAll();
setInterval(tick, MIN);
