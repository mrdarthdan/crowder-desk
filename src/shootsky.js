// shootsky.js — the Shoot Planner's sun, moon, Milky Way and scoring code, kept identical to
// shoot-planner/sky.js on vPages so both apps give the same scores. Update the two together.
// Sun and moon formulas follow Vladimir Agafonkin's SunCalc (BSD-2), trimmed and adapted.

const PI = Math.PI, rad = PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545;
const e = rad * 23.4397;
const toJulian = d => d.valueOf() / dayMs - 0.5 + J1970;
const fromJulian = j => new Date((j + 0.5 - J1970) * dayMs);
const toDays = d => toJulian(d) - J2000;
const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const azimuth = (H, phi, dec) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
const altitude = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
const astroRefraction = h => { if (h < 0) h = 0; return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179)); };
const solarMeanAnomaly = d => rad * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + PI;
}
function sunCoords(d) {
  const L = eclipticLongitude(solarMeanAnomaly(d));
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}
// azimuth returned in compass degrees (0 = N, 90 = E)
const compass = az => ((az / rad) + 180 + 360) % 360;

export function sunPosition(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date), c = sunCoords(d), H = siderealTime(d, lw) - c.ra;
  return { az: compass(azimuth(H, phi, c.dec)), alt: altitude(H, phi, c.dec) / rad };
}

const J0 = 0.0009;
const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2 * PI));
const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * PI) + n;
const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
const hourAngle = (h, phi, d) => Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));
const observerAngle = height => -2.076 * Math.sqrt(height) / 60;
function getSetJ(h, lw, phi, dec, n, M, L) {
  const w = hourAngle(h, phi, dec), a = approxTransit(w, lw, n);
  return solarTransitJ(a, M, L);
}
const SUN_EVENTS = [[-0.833, 'sunrise', 'sunset'], [-0.3, 'sunriseEnd', 'sunsetStart'], [-4, 'blueDawnEnd', 'blueDuskStart'], [-8, 'blueDawnStart', 'blueDuskEnd'], [-6, 'dawn', 'dusk'], [-12, 'nauticalDawn', 'nauticalDusk'], [-18, 'nightEnd', 'night'], [6, 'goldenHourEnd', 'goldenHour']];

// Sun times for the calendar day containing `date` (pass local noon for best results).
export function sunTimes(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date), n = julianCycle(d, lw), ds = approxTransit(0, lw, n),
    M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0), Jnoon = solarTransitJ(ds, M, L);
  const r = { solarNoon: fromJulian(Jnoon), nadir: fromJulian(Jnoon - 0.5) };
  for (const [deg, rise, set] of SUN_EVENTS) {
    const h0 = (deg + observerAngle(0)) * rad, Jset = getSetJ(h0, lw, phi, dec, n, M, L), Jrise = Jnoon - (Jset - Jnoon);
    r[rise] = fromJulian(Jrise); r[set] = fromJulian(Jset);
  }
  return r;
}

function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F), dt = 385001 - 20905 * Math.cos(M);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
}
export function moonPosition(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date), c = moonCoords(d), H = siderealTime(d, lw) - c.ra;
  let h = altitude(H, phi, c.dec);
  h = h + astroRefraction(h);
  return { az: compass(azimuth(H, phi, c.dec)), alt: h / rad };
}
export function moonIllumination(date) {
  const d = toDays(date || new Date()), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / PI };
}
export function moonPhaseName(p) {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.round(p * 8) % 8];
}

// Galactic centre (Sgr A*): RA 266.405°, Dec −29.008°
const GC_RA = 266.405 * rad, GC_DEC = -29.008 * rad;
export function galacticCenter(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date), H = siderealTime(d, lw) - GC_RA;
  return { az: compass(azimuth(H, phi, GC_DEC)), alt: altitude(H, phi, GC_DEC) / rad };
}

// Scan from dusk to dawn (5-minute steps) for a dark sky with the Milky Way core above 10°.
export function milkyWayWindow(dayNoon, lat, lng) {
  const today = sunTimes(dayNoon, lat, lng), tomorrow = sunTimes(new Date(dayNoon.valueOf() + dayMs), lat, lng);
  const start = today.night, end = tomorrow.nightEnd;
  if (!(start instanceof Date) || isNaN(start) || isNaN(end)) return null;
  let best = null, cur = null;
  for (let t = start.valueOf(); t <= end.valueOf(); t += 3e5) {
    const dt = new Date(t), gc = galacticCenter(dt, lat, lng), mo = moonPosition(dt, lat, lng);
    const ok = gc.alt > 10 && mo.alt < 0;
    if (ok) { if (!cur) cur = { start: dt, peakAlt: gc.alt, peakAz: gc.az, peak: dt }; cur.end = dt; if (gc.alt > cur.peakAlt) { cur.peakAlt = gc.alt; cur.peakAz = gc.az; cur.peak = dt; } }
    else if (cur) { if (!best || cur.end - cur.start > best.end - best.start) best = cur; cur = null; }
  }
  if (cur && (!best || cur.end - cur.start > best.end - best.start)) best = cur;
  return best;
}

export const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const dirName = az => COMPASS16[Math.round(az / 22.5) % 16];
export const dirDeg = name => { const i = COMPASS16.indexOf((name || '').toUpperCase().trim()); return i < 0 ? null : i * 22.5; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- scoring ----------
// w: weather at the moment that matters, from Open-Meteo hourly data:
// { low, mid, high, total (cloud %), precip (probability %), wind (mph), gust, vis (m), temp (°F) }
// Desert color comes from mid and high cloud catching light under a clear western/eastern horizon.
// Thick low cloud blocks the sun; dead clear sky is clean but plain.
export function scoreGolden(w) {
  const reasons = [];
  const canvas = Math.max(w.high, w.mid * 0.9);
  let s;
  if (canvas < 10) { s = 45; reasons.push('Clear sky: clean light, plain sky'); }
  else if (canvas <= 75) { s = 55 + 40 * (1 - Math.abs(canvas - 45) / 45); reasons.push(`${Math.round(canvas)}% high/mid cloud to catch color`); }
  else { s = 70 - (canvas - 75) * 1.2; reasons.push('Heavy overcast up high: color may be muted'); }
  if (w.low > 30) { s -= (w.low - 30) * 0.9; reasons.push(`${Math.round(w.low)}% low cloud could block the sun`); }
  if (w.precip >= 40) { s -= (w.precip - 30) * 0.35; reasons.push(`${Math.round(w.precip)}% chance of rain`); }
  else if (w.precip >= 15 && canvas >= 20) { s += 5; reasons.push('Passing showers nearby: drama possible'); }
  if (w.vis != null && w.vis < 10000) { s -= 10; reasons.push('Hazy or dusty air'); }
  if (w.wind >= 20) { s -= 8; reasons.push(`Windy (${Math.round(w.wind)} mph): tripod shake, dust`); }
  return { score: Math.round(clamp(s, 0, 100)), reasons };
}

export function scoreBlue(w) {
  const reasons = [];
  let s = 70;
  const canvas = Math.max(w.high, w.mid);
  if (canvas >= 15 && canvas <= 70) { s += 12; reasons.push('Some cloud texture for afterglow'); }
  if (w.low > 50) { s -= (w.low - 50) * 0.7; reasons.push('Low cloud dulls the afterglow'); }
  if (w.precip >= 40) { s -= 15; reasons.push(`${Math.round(w.precip)}% chance of rain`); }
  if (w.wind >= 20) { s -= 8; reasons.push(`Windy (${Math.round(w.wind)} mph)`); }
  if (!reasons.length) reasons.push('Even blue light for city and architecture');
  return { score: Math.round(clamp(s, 0, 100)), reasons };
}

// mw: result of milkyWayWindow or null; moon: { fraction, upMidnight }
export function scoreNight(w, mw, moon) {
  const reasons = [];
  let s = 100 - w.total * 0.9;
  if (w.total > 20) reasons.push(`${Math.round(w.total)}% cloud cover`); else reasons.push('Clear sky');
  if (mw) {
    const hrs = (mw.end - mw.start) / 36e5;
    reasons.push(`Milky Way core up ${hrs.toFixed(1)} h with no moon, peaks ${Math.round(mw.peakAlt)}° ${dirName(mw.peakAz)}`);
    if (hrs < 1) s -= 15;
  } else {
    s -= moon.fraction > 0.5 ? 30 + moon.fraction * 25 : 35;
    reasons.push(moon.fraction > 0.5 ? `Moon ${Math.round(moon.fraction * 100)}% lit: core washed out` : 'Milky Way core not up in a dark sky');
  }
  if (!mw && moon.fraction < 0.25) { s += 10; reasons.push('Dark moon: good for star trails'); }
  if (w.wind >= 20) { s -= 8; reasons.push(`Windy (${Math.round(w.wind)} mph)`); }
  return { score: Math.round(clamp(s, 0, 100)), reasons };
}

export function verdict(score) {
  if (score >= 75) return { label: 'Go', cls: 'go' };
  if (score >= 55) return { label: 'Maybe', cls: 'maybe' };
  return { label: 'Skip', cls: 'skip' };
}

// How the sun sits relative to the way a spot faces.
export function facingNote(spotFacing, sunAz, session) {
  const f = dirDeg(spotFacing);
  if (f == null || sunAz == null) return null;
  let diff = Math.abs(((sunAz - f) + 540) % 360 - 180);
  if (diff <= 45) return session === 'sunrise' ? 'Sun rises right into your frame: backlit silhouettes' : 'Sun sets in your frame: backlit, shoot the sky';
  if (diff >= 135) return session === 'sunrise' ? 'Sun behind you: first light on the subject' : 'Sun behind you: last light on the subject';
  return 'Side light across the scene';
}
