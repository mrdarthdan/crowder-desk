import { fetchRecipe, fetchSections, openUrl, esc, KITCHEN_URL } from './api.js';
import { ui } from './icons.js';

const root = document.getElementById('rp');

function fmtSeconds(s) {
  if (!s) return '';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

const FRACTIONS = [[0.125, '⅛'], [0.25, '¼'], [0.333, '⅓'], [0.5, '½'], [0.667, '⅔'], [0.75, '¾']];
function fmtQty(q) {
  if (typeof q !== 'number') return q;
  const whole = Math.floor(q), frac = q - whole;
  if (frac < 0.01) return String(whole);
  const f = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.02);
  return f ? `${whole || ''}${f[1]}` : String(+q.toFixed(2));
}

function qtyText(it) {
  return [fmtQty(it.qty), it.unit].filter((x) => x !== null && x !== undefined && x !== '').join(' ');
}

async function loadRecipe(id) {
  root.innerHTML = '<div class="placeholder">Loading recipe…</div>';
  try {
    const [r, sections] = await Promise.all([fetchRecipe(id), fetchSections().catch(() => [])]);
    if (!r) { root.innerHTML = '<div class="empty">That recipe is no longer in Crowder Kitchen.</div>'; return; }
    document.title = `${r.title} · Crowder Desk`;
    const section = sections.find((s) => s.id === r.section_id)?.name || '';

    const groups = Array.isArray(r.ingredients) ? r.ingredients : [];
    const ingredients = groups.map((g) => `
      ${g.name ? `<h3>${esc(g.name)}</h3>` : ''}
      <ul class="ing">${(g.items || []).map((it) =>
        `<li><span class="q">${esc(qtyText(it))}</span><span>${esc(it.item)}</span></li>`).join('')}</ul>`).join('');

    const steps = (Array.isArray(r.steps) ? r.steps : []).map((s) => `
      <li><div>
        ${s.title ? `<div class="st">${esc(s.title)}</div>` : ''}
        <div class="tx">${esc(s.text)}</div>
        ${s.seconds ? `<span class="tm">${fmtSeconds(s.seconds)}</span>` : ''}
      </div></li>`).join('');

    const notes = (Array.isArray(r.notes) ? r.notes : []).filter(Boolean);
    const meta = [r.time, r.serves ? `Serves ${r.serves}` : '', r.contributor].filter(Boolean);

    root.innerHTML = `
      <div class="rp-kicker">${esc(section)}</div>
      <h1>${esc(r.title)}</h1>
      <div class="rp-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>
      ${r.description ? `<p class="rp-desc">${esc(r.description)}</p>` : ''}
      ${ingredients ? `<h2>Ingredients</h2>${ingredients}` : ''}
      ${steps ? `<h2>Steps</h2><ol class="steps">${steps}</ol>` : ''}
      ${notes.length ? `<h2>Notes</h2><ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${r.tags?.length ? `<div class="tags">${r.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="rp-foot">
        <span class="grow"></span>
        ${/^https?:\/\//.test(r.source_url || '') ? `<button class="btn" id="rp-src">${ui.ext}Original source</button>` : ''}
        <button class="btn" id="rp-kitchen">${ui.ext}Open Crowder Kitchen</button>
      </div>`;
    document.getElementById('rp-kitchen').addEventListener('click', () => openUrl(KITCHEN_URL));
    document.getElementById('rp-src')?.addEventListener('click', () => openUrl(r.source_url));
    window.scrollTo(0, 0);
  } catch {
    root.innerHTML = '<div class="placeholder">Couldn\'t load this recipe. Check your connection and try again.</div>';
  }
}

window.loadRecipe = loadRecipe;
const id = window.__RECIPE_ID__ || new URLSearchParams(location.search).get('id');
if (id) loadRecipe(id);
else root.innerHTML = '<div class="empty">No recipe selected.</div>';
