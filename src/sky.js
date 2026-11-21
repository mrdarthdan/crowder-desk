// Sun and moon positions for the Light card.
// Formulas follow the SunCalc approach (Vladimir Agafonkin, BSD-2-Clause),
// based on Astronomy Answers articles. Accuracy is about a minute — plenty for planning a shoot.

const PI = Math.PI, sin = Math.sin, cos = Math.cos, tan = Math.tan,
  asin = Math.asin, atan = Math.atan2, acos = Math.acos, rad = PI / 180;
const dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009;
const e = rad * 23.4397; // obliquity of the Earth

const toJulian = (date) => date.valueOf() / dayMs - 0.5 + J1970;
const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
const toDays = (date) => toJulian(date) - J2000;

const rightAscension = (l, b) => atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l));
const declination = (l, b) => asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
const altitude = (H, phi, dec) => asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
function astroRefraction(h) {
  if (h < 0) h = 0;
  return 0.0002967 / tan(h + 0.00312536 / (h + 0.08901179));
}

const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
  const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M));
  return M + C + rad * 102.9372 + PI;
}
function sunCoords(d) {
  const L = eclipticLongitude(solarMeanAnomaly(d));
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2 * PI));
const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * PI) + n;
const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
const hourAngle = (h, phi, d) => acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d)));

/**
 * Times when the sun crosses the given altitudes (degrees) around `date`'s solar noon.
 * Returns { noon, [angle]: { rise, set } } with Date values (NaN dates when it never happens).
 */
export function sunTimes(date, lat, lng, angles) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date);
  const n = julianCycle(d, lw), ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0);
  const Jnoon = solarTransitJ(ds, M, L);
  const out = { noon: fromJulian(Jnoon) };
  for (const a of angles) {
    const w = hourAngle(a * rad, phi, dec);
    const Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
    out[a] = { rise: fromJulian(Jnoon - (Jset - Jnoon)), set: fromJulian(Jset) };
  }
  return out;
}

function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d),
    F = rad * (93.272 + 13.229350 * d);
  const l = L + rad * 6.289 * sin(M), b = rad * 5.128 * sin(F), dt = 385001 - 20905 * cos(M);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
}

function moonAltitude(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date);
  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  const h = altitude(H, phi, c.dec);
  return h + astroRefraction(h);
}

/** fraction: 0..1 lit; phase: 0 new → 0.25 first quarter → 0.5 full → 0.75 last quarter. */
export function moonIllumination(date) {
  const d = toDays(date), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
  const phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
  const inc = atan(sdist * sin(phi), m.dist - sdist * cos(phi));
  const angle = atan(cos(s.dec) * sin(s.ra - m.ra),
    sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));
  return { fraction: (1 + cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / PI };
}

/** Moonrise/moonset within the 24 hours after `start` (pass local midnight). */
export function moonTimes(start, lat, lng) {
  const at = (h) => new Date(start.valueOf() + h * 36e5);
  const hc = 0.133 * rad;
  let h0 = moonAltitude(start, lat, lng) - hc, rise, set;
  for (let i = 1; i <= 24; i += 2) {
    const h1 = moonAltitude(at(i), lat, lng) - hc, h2 = moonAltitude(at(i + 1), lat, lng) - hc;
    const a = (h0 + h2) / 2 - h1, b = (h2 - h0) / 2, xe = -b / (2 * a), ye = (a * xe + b) * xe + h1;
    const disc = b * b - 4 * a * h1;
    let roots = 0, x1 = 0, x2 = 0;
    if (disc >= 0) {
      const dx = Math.sqrt(disc) / (Math.abs(a) * 2);
      x1 = xe - dx; x2 = xe + dx;
      if (Math.abs(x1) <= 1) roots++;
      if (Math.abs(x2) <= 1) roots++;
      if (x1 < -1) x1 = x2;
    }
    if (roots === 1) { if (h0 < 0) rise = i + x1; else set = i + x1; }
    else if (roots === 2) { rise = i + (ye < 0 ? x2 : x1); set = i + (ye < 0 ? x1 : x2); }
    if (rise && set) break;
    h0 = h2;
  }
  return { rise: rise ? at(rise) : null, set: set ? at(set) : null };
}

export function phaseName(p) {
  if (p < 0.03 || p > 0.97) return 'New moon';
  if (p < 0.22) return 'Waxing crescent';
  if (p < 0.28) return 'First quarter';
  if (p < 0.47) return 'Waxing gibbous';
  if (p < 0.53) return 'Full moon';
  if (p < 0.72) return 'Waning gibbous';
  if (p < 0.78) return 'Last quarter';
  return 'Waning crescent';
}

/** Moon drawn with its lit part, as seen from the northern hemisphere. */
export function moonSvg(phase) {
  const r = 13, cx = 16, cy = 16;
  const waxing = phase < 0.5;
  const t = cos(2 * PI * phase); // 1 = new, -1 = full
  const rx = Math.max(0.01, Math.abs(t) * r);
  const outer = waxing ? 1 : 0;
  const inner = t > 0 ? (waxing ? 0 : 1) : (waxing ? 1 : 0);
  return `<svg viewBox="0 0 32 32" class="moon" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="${r}" class="moon-dark"/>
    <path class="moon-lit" d="M${cx} ${cy - r} A${r} ${r} 0 0 ${outer} ${cx} ${cy + r} A${rx.toFixed(2)} ${r} 0 0 ${inner} ${cx} ${cy - r}Z"/>
  </svg>`;
}

/**
 * Rough sunset/sunrise color outlook from Open-Meteo cloud layers (percent).
 * High and mid clouds catch color; low clouds near the horizon block it.
 */
export function colorOutlook(low, mid, high, total) {
  const canvas = Math.max(high, mid);
  let s;
  if (canvas < 10) s = 25;
  else if (canvas <= 80) s = 55 + 40 * (1 - Math.abs(canvas - 45) / 45);
  else s = 50 - (canvas - 80);
  s -= low * 0.6;
  if (total > 90) s -= 20;
  s = Math.max(0, Math.min(100, Math.round(s)));
  let label;
  if (canvas < 10 && low < 15) label = 'Clear sky: clean light, little color';
  else if (s >= 70) label = 'Promising: worth heading out';
  else if (s >= 45) label = 'Decent: some color likely';
  else if (low >= 50 || total > 90) label = 'Low clouds may block the light';
  else label = 'Probably muted';
  return { score: s, label };
}
