// Shoot Planner data for the Crowder Desk card: spots and outings from Supabase,
// forecasts from Open-Meteo and NWS alerts, scored with the planner's own rules (shootsky.js).

import { rest } from './api.js';
import * as Sky from './shootsky.js';

export const SHOOT_URL = 'https://darthdan.vpages.site/shoot-planner/';
export const SESSIONS = { sunrise: 'Sunrise', sunset: 'Sunset', blue: 'Blue hour', night: 'Night sky' };

const sessionsFor = (spot) => {
  const b = (spot.best_light || []).filter((x) => SESSIONS[x]);
  return b.length ? b : ['sunrise', 'sunset'];
};

/** Everything the card needs, as plain JSON so it can be cached for offline starts. */
export async function fetchShoot() {
  const [spots, outings] = await Promise.all([
    rest('shoot_spots?select=id,name,lat,lng,area,kind,best_light,facing,favorite&order=favorite.desc,name.asc'),
    rest(`shoot_outings?select=id,spot_id,date,session,status,shot_list,packing&status=eq.planned&date=gte.${today()}&order=date.asc&limit=5`),
  ]);
  if (!spots.length) return { spots, outings, wx: {}, alerts: {} };
  const p = new URLSearchParams({
    latitude: spots.map((s) => s.lat.toFixed(4)).join(','),
    longitude: spots.map((s) => s.lng.toFixed(4)).join(','),
    hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation_probability,wind_speed_10m,wind_gusts_10m,visibility,temperature_2m',
    daily: 'temperature_2m_max',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timeformat: 'unixtime', timezone: 'auto', forecast_days: '3',
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
  if (!r.ok) throw new Error('Forecast unavailable');
  let j = await r.json();
  if (!Array.isArray(j)) j = [j];
  const wx = {};
  spots.forEach((s, i) => {
    const { hourly, daily } = j[i];
    wx[s.id] = { hourly, daily };
  });
  const alerts = {};
  await Promise.all(spots.map(async (s) => {
    try {
      const a = await fetch(`https://api.weather.gov/alerts/active?point=${s.lat.toFixed(4)},${s.lng.toFixed(4)}`, { headers: { Accept: 'application/geo+json' } });
      if (!a.ok) return;
      const aj = await a.json();
      alerts[s.id] = (aj.features || []).map((f) => ({ event: f.properties.event, ends: f.properties.ends || f.properties.expires }));
    } catch { /* alerts are a bonus */ }
  }));
  return { spots, outings, wx, alerts };
}

function today() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function wxAt(w, t0, t1) {
  if (!w?.hourly) return null;
  const h = w.hourly, times = h.time;
  const a = t0.valueOf() / 1000, b = (t1 || t0).valueOf() / 1000;
  let idx = [];
  for (let i = 0; i < times.length; i++) if (times[i] >= a - 1800 && times[i] <= b + 1800) idx.push(i);
  if (!idx.length) return null;
  if (!t1) idx = [idx.reduce((best, i) => (Math.abs(times[i] - a) < Math.abs(times[best] - a) ? i : best), idx[0])];
  const avg = (k) => idx.reduce((s, i) => s + (h[k][i] ?? 0), 0) / idx.length;
  const max = (k) => Math.max(...idx.map((i) => h[k][i] ?? 0));
  return {
    total: avg('cloud_cover'), low: avg('cloud_cover_low'), mid: avg('cloud_cover_mid'), high: avg('cloud_cover_high'),
    precip: max('precipitation_probability'), wind: avg('wind_speed_10m'), gust: max('wind_gusts_10m'),
    vis: avg('visibility'), temp: avg('temperature_2m'),
  };
}

function dailyMax(w, noon) {
  const d = w?.daily; if (!d) return null;
  const t = noon.valueOf() / 1000;
  const i = d.time.findIndex((x) => Math.abs(x + 43200 - t) < 43200);
  return i < 0 ? null : d.temperature_2m_max[i];
}

/** Same rules as the planner's planFor(). `noon` is local noon of the day. */
export function planFor(spot, noon, session, data) {
  const w0 = data.wx[spot.id];
  const t = Sky.sunTimes(noon, spot.lat, spot.lng);
  const moon = Sky.moonIllumination(new Date(noon.valueOf() + 12 * 36e5));
  let window, w, res, sunAz = null;
  const extra = [];
  if (session === 'sunrise') {
    window = [t.blueDawnStart, t.goldenHourEnd]; w = wxAt(w0, t.sunrise);
    sunAz = Sky.sunPosition(t.sunrise, spot.lat, spot.lng).az;
    if (w) res = Sky.scoreGolden(w);
  } else if (session === 'sunset') {
    window = [t.goldenHour, t.blueDuskEnd]; w = wxAt(w0, t.sunset);
    sunAz = Sky.sunPosition(t.sunset, spot.lat, spot.lng).az;
    if (w) res = Sky.scoreGolden(w);
  } else if (session === 'blue') {
    window = [t.blueDuskStart, t.blueDuskEnd]; w = wxAt(w0, t.dusk);
    if (w) res = Sky.scoreBlue(w);
  } else {
    const mw = Sky.milkyWayWindow(noon, spot.lat, spot.lng);
    const nextDawn = Sky.sunTimes(new Date(noon.valueOf() + 864e5), spot.lat, spot.lng).nightEnd;
    window = mw ? [mw.start, mw.end] : [t.night, nextDawn];
    w = wxAt(w0, window[0], window[1]);
    if (w) res = Sky.scoreNight(w, mw, moon);
  }
  const facing = Sky.facingNote(spot.facing, sunAz, session);
  if (res && facing && facing.includes('behind you') && w.high < 10 && w.mid < 10 && w.low < 30) {
    res.score = Math.min(100, res.score + 15);
    res.reasons.push('Clear sky suits this spot: clean, warm light on the subject');
  }
  const warn = [];
  const hi = dailyMax(w0, noon);
  if (hi != null && hi >= 105 && session !== 'night') warn.push(`Heat: high of ${Math.round(hi)}°F`);
  if (w && w.gust >= 35) warn.push(`Gusts to ${Math.round(w.gust)} mph`);
  for (const a of data.alerts[spot.id] || []) if (!a.ends || new Date(a.ends) > window[0]) warn.push(a.event);
  return { spot, session, window, w, score: res ? res.score : null, reasons: res ? [...res.reasons, ...extra] : extra, facing, warn };
}

/** Scored sessions still ahead in the next ~36 hours, best first. */
export function upcoming(data, now = Date.now()) {
  const out = [];
  for (let k = 0; k < 2; k++) {
    const noon = new Date(); noon.setHours(12, 0, 0, 0); noon.setDate(noon.getDate() + k);
    for (const s of data.spots) {
      for (const ses of sessionsFor(s)) {
        const p = planFor(s, noon, ses, data);
        if (p.score == null || !(p.window[1] > now)) continue;
        if (p.window[0] - now > 36 * 36e5) continue;
        out.push({ ...p, dayOffset: k });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score || a.window[0] - b.window[0]);
}

export const verdict = Sky.verdict;
