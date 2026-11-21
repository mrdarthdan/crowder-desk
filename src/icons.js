// Line-art weather and UI icons. Weather codes follow WMO (Open-Meteo).

const sun = `<circle cx="16" cy="16" r="5.5" class="fill-sun"/>
  <g class="ray">${[0, 45, 90, 135, 180, 225, 270, 315]
    .map((a) => `<line x1="16" y1="4.5" x2="16" y2="7" transform="rotate(${a} 16 16)"/>`).join('')}</g>`;
const moon = `<path d="M20.5 7.5a8.5 8.5 0 1 0 4 11.5 7 7 0 0 1-4-11.5z" class="fill-moon"/>`;
const cloud = (y = 0) => `<path transform="translate(0 ${y})" d="M10 25h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 10.2 16.1 4.5 4.5 0 0 0 10 25z" class="fill-cloud"/>`;
const smallSun = `<g transform="translate(-4 -5) scale(.8)">${sun}</g>`;
const smallMoon = `<g transform="translate(-3 -4) scale(.8)">${moon}</g>`;
const drops = `<g class="drop"><line x1="12" y1="27" x2="11" y2="30"/><line x1="17" y1="27" x2="16" y2="30"/><line x1="22" y1="27" x2="21" y2="30"/></g>`;
const flakes = `<g class="drop"><circle cx="12" cy="28.5" r="1"/><circle cx="17" cy="29.5" r="1"/><circle cx="22" cy="28.5" r="1"/></g>`;
const bolt = `<path d="M17 24l-3 5h4l-2 4" class="bolt"/>`;
const fogLines = `<g class="drop"><line x1="7" y1="21" x2="25" y2="21"/><line x1="9" y1="25" x2="27" y2="25"/><line x1="6" y1="29" x2="22" y2="29"/></g>`;

const svg = (inner) => `<svg viewBox="0 0 32 32" class="wx" aria-hidden="true">${inner}</svg>`;

export function weatherInfo(code, isDay = 1) {
  const day = !!isDay;
  if (code === 0) return { label: day ? 'Clear' : 'Clear night', icon: svg(day ? sun : moon) };
  if (code === 1) return { label: 'Mostly clear', icon: svg(day ? sun : moon) };
  if (code === 2) return { label: 'Partly cloudy', icon: svg((day ? smallSun : smallMoon) + cloud(1)) };
  if (code === 3) return { label: 'Overcast', icon: svg(cloud(-2)) };
  if (code === 45 || code === 48) return { label: 'Fog', icon: svg(cloud(-8) + fogLines) };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: svg(cloud(-4) + drops) };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: code >= 80 ? 'Showers' : 'Rain', icon: svg(cloud(-4) + drops) };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', icon: svg(cloud(-4) + flakes) };
  if (code >= 95) return { label: 'Thunderstorms', icon: svg(cloud(-5) + bolt) };
  return { label: '—', icon: svg(cloud(-2)) };
}

export const ui = {
  refresh: `<svg viewBox="0 0 20 20"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2"/></svg>`,
  gear: `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/></svg>`,
  hide: `<svg viewBox="0 0 20 20"><path d="M5 10h10"/></svg>`,
  prev: `<svg viewBox="0 0 20 20"><path d="M12.5 4.5L7 10l5.5 5.5"/></svg>`,
  next: `<svg viewBox="0 0 20 20"><path d="M7.5 4.5L13 10l-5.5 5.5"/></svg>`,
  shuffle: `<svg viewBox="0 0 20 20"><path d="M3 6h3.5c2.5 0 4 8 7 8H17M14.5 11.5L17 14l-2.5 2.5M3 14h3.5c1.2 0 2-1.6 2.8-3.4M11.6 7.6C12.2 6.7 12.9 6 14 6h3M14.5 3.5L17 6l-2.5 2.5"/></svg>`,
  ext: `<svg viewBox="0 0 20 20"><path d="M11 4h5v5M16 4l-7 7M14 12v4H4V6h4"/></svg>`,
  up: `<svg viewBox="0 0 20 20"><path d="M5 12.5L10 7l5 5.5"/></svg>`,
  down: `<svg viewBox="0 0 20 20"><path d="M5 7.5L10 13l5-5.5"/></svg>`,
  grip: `<svg viewBox="0 0 24 8"><g fill="currentColor" stroke="none"><circle cx="6" cy="2" r="1.3"/><circle cx="12" cy="2" r="1.3"/><circle cx="18" cy="2" r="1.3"/><circle cx="6" cy="6" r="1.3"/><circle cx="12" cy="6" r="1.3"/><circle cx="18" cy="6" r="1.3"/></g></svg>`,
  close: `<svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15"/></svg>`,
  sunset: `<svg viewBox="0 0 20 20"><path d="M3 15h14M5.5 15a4.5 4.5 0 0 1 9 0M10 4v3M4.3 8.3l1.4 1.4M15.7 8.3l-1.4 1.4"/></svg>`,
  wind: `<svg viewBox="0 0 20 20"><path d="M3 8h9a2.5 2.5 0 1 0-2.5-2.5M3 12h12a2.5 2.5 0 1 1-2.5 2.5"/></svg>`,
  drop: `<svg viewBox="0 0 20 20"><path d="M10 3s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9z"/></svg>`,
};
