/* tome.js — logic shared by both mockups.
 *
 * Helpers are ported from The-Adventures-of-Jules.html rather than rewritten, so the
 * mockups differ from the original in structure only.
 *
 * The `prep` block below is the interesting part. It does work the BROWSER SHOULD NOT
 * BE DOING — deriving a capture's day by string-matching, and quarantining nonsense
 * timestamps. It lives here so the mockups are honest about what the current payload
 * forces on the client. If a direction wins, prep moves into the Python payload builder
 * (Phase 2 / payloads.md), where the joins can be validated and failures reported to the
 * user at build time. See mockups/README.md.
 */
"use strict";

/* ---------- data source: real Jules payload, or a fixture via ?data= ---------- */
// jules-data.js (or a fixture) has already assigned these as globals.
const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emph = s => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const numWord = n => (n < NUMW.length ? NUMW[n].replace(/^./, c => c.toUpperCase()) : String(n));
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

/* ---------- actor colours (top 5 distinct, rest grey) ---------- */
const ACTOR_PAL = ['var(--gold)', 'var(--steel)', 'var(--blood)', 'var(--moss)', 'var(--violet)'];
const actorColor = {};
(SN.actors || []).slice(0, 5).forEach((a, i) => actorColor[a.name] = ACTOR_PAL[i]);
const topActorNames = (SN.actors || []).slice(0, 5).map(a => a.name);
const colorFor = name => actorColor[name] || 'var(--dim)';

/* ---------- event categories ---------- */
const CAT = {
  dialogue: { label: 'Dialogue', color: 'var(--gold)', types: ['dialogue', 'dialogue_background', 'dialogue_npc', 'dialogue_player', 'dialogue_player_stt', 'dialogue_player_text', 'gamemaster_dialogue'] },
  death:    { label: 'Death & Combat', color: 'var(--blood)', types: ['death'] },
  thought:  { label: 'Thoughts & Narration', color: 'var(--steel)', types: ['player_thoughts', 'direct_narration', 'diary_entry_created'] },
  world:    { label: 'Trade, Rest & World', color: 'var(--moss)', types: ['trade_start', 'trade_complete', 'sleep_start', 'sleep_stop', 'book_read', 'furniture_used', 'item_given'] },
  follow:   { label: 'Followers & Tasks', color: 'var(--dim)', types: [] }
};
const catOf = t => { for (const k in CAT) { if (CAT[k].types.includes(t)) return k; } return 'follow'; };
const CATORDER = ['dialogue', 'death', 'thought', 'world', 'follow'];

/* ==========================================================================
   PREP — the layer that belongs in Python, not here.
   ========================================================================== */

/* Timestamp quarantine.
 *
 * payloads.md calls `gt` "raw game_time, for chronological sorting". In the Jules payload
 * it silently mixes two units:
 *   - 249 memories: in-game clock, 0 .. 1,281,339
 *   -   6 memories: a Unix epoch. 1784014205 => 2026-07-14T07:30Z, the day the page was built.
 *
 * Sorting by gt across all 255 puts those 6 a thousandfold past the end. Sorting the 249
 * well-formed rows reproduces ordered_days with zero inversions — so gt is not broken,
 * it is contaminated. Quarantine the outliers; don't "fix" the sort.
 *
 * The two clusters are ~3 orders of magnitude apart, so the threshold is not delicate.
 * A real in-game clock would have to exceed ~31 years of game time to reach 1e9.
 */
const GT_EPOCH_FLOOR = 1e9;
const gtEpoch = m => typeof m.gt === 'number' && m.gt >= GT_EPOCH_FLOOR;   // wall-clock leaked in
const gtMissing = m => !(typeof m.gt === 'number' && isFinite(m.gt)) || m.gt <= 0;  // absent/zero
const gtUsable = m => !gtEpoch(m) && !gtMissing(m);

/* A memory is dated iff the generator resolved a day label for it. In Jules this is exactly
 * equivalent to gt being usable — the undated rows ARE the contaminated ones — but a save
 * could in principle have one without the other, so both are checked. */
const isDated = m => m.day != null && m.day !== '';

const DAY_INDEX = {};
(SN.ordered_days || []).forEach((d, i) => DAY_INDEX[d] = i);

/* Capture -> day.
 *
 * NOT SHIPPABLE AS-IS. payloads.md specifies screenshots[].ts only as "the capture
 * date/time string" — the format is never pinned down. This works because Jules's ts
 * happens to embed an ordered_days label verbatim ("8:55 AM, Tirdas, 19th of Last Seed,
 * 4E 201"), which holds for 163/163. The generator reads omnisight_screenshots.capture_time_game,
 * which shares a format with events.game_time_str, so the same rule applies at build time —
 * but the browser should be handed a `day` field, not asked to guess.
 *
 * Even with that field, a capture on a day with no EVENTS has no slot: ordered_days is
 * derived from the events table alone. Jules cannot expose this (it has events every day).
 * Orphans are counted below rather than dropped, so the failure is at least visible. */
function captureDay(s) {
  const ts = s.ts || '';
  for (const d of (SN.ordered_days || [])) if (ts.indexOf(d) !== -1) return d;
  return null;
}

/* Capture -> minutes since midnight, for ordering within a day. Same caveat: parsed from
 * an unspecified string format. Returns null when unparseable, which sorts last. */
function captureMinutes(s) {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(s.ts || '');
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2], 10);
}

const prep = (() => {
  const mems = SN.memories || [];
  const dated = mems.filter(isDated);
  const undated = mems.filter(m => !isDated(m));
  const epochRows = mems.filter(gtEpoch);
  const zeroRows = mems.filter(gtMissing);

  // memories by day, in gt order within each day
  const byDay = {};
  for (const d of (SN.ordered_days || [])) byDay[d] = [];
  const orphanMems = [];
  for (const m of dated) {
    if (byDay[m.day]) byDay[m.day].push(m);
    else orphanMems.push(m); // a day label that isn't on the rail
  }
  for (const d in byDay) byDay[d].sort((a, b) => (gtUsable(a) ? a.gt : Infinity) - (gtUsable(b) ? b.gt : Infinity));

  // captures by day, in time-of-day order
  const capsByDay = {};
  for (const d of (SN.ordered_days || [])) capsByDay[d] = [];
  const orphanCaps = [];
  for (const s of (SN.screenshots || [])) {
    const d = captureDay(s);
    const rec = Object.assign({}, s, { day: d, mins: captureMinutes(s) });
    if (d && capsByDay[d]) capsByDay[d].push(rec);
    else orphanCaps.push(rec);
  }
  for (const d in capsByDay) capsByDay[d].sort((a, b) => (a.mins == null ? Infinity : a.mins) - (b.mins == null ? Infinity : b.mins));

  // event counts per day, split by category
  const evByDay = {};
  for (const d of (SN.ordered_days || [])) evByDay[d] = { total: 0, cats: {} };
  for (const key in (SN.events_by_day || {})) {
    const bar = key.indexOf('|');
    const day = key.slice(0, bar), type = key.slice(bar + 1);
    if (!evByDay[day]) continue;
    const n = SN.events_by_day[key];
    evByDay[day].total += n;
    const c = catOf(type);
    evByDay[day].cats[c] = (evByDay[day].cats[c] || 0) + n;
  }

  const maxEvents = Math.max(1, ...Object.values(evByDay).map(e => e.total));

  return {
    dated, undated, epochRows, zeroRows, byDay, capsByDay, evByDay, maxEvents,
    orphanMems, orphanCaps,
    days: (SN.ordered_days || []),
    hasCaptures: (SN.screenshots || []).length > 0,
    hasDiary: (SN.diary || []).length > 0,
    hasGossip: (typeof GOSSIP !== 'undefined' && GOSSIP.length > 0),
    hasWar: !!(IE && IE.has_war && (IE.war || []).length),
    hasFeature: !!(SN.feature && SN.feature.title),
  };
})();

/* One place to report every honesty gap, so no mockup can quietly drop a record. */
function dataNotices() {
  const out = [];
  if (prep.undated.length) {
    const bits = [];
    if (prep.epochRows.length) {
      const d = new Date(prep.epochRows[0].gt * 1000).toISOString().slice(0, 10);
      bits.push(`${prep.epochRows.length} carry a <code>gt</code> in the 1.78e9 range, which decodes as a real-world timestamp (${d}) — wall-clock leaked into a game-time field`);
    }
    if (prep.zeroRows.length) bits.push(`${prep.zeroRows.length} ${prep.zeroRows.length === 1 ? 'has' : 'have'} <code>gt</code> of 0`);
    out.push({
      title: 'Undated memories',
      body: `${prep.undated.length} of ${(SN.memories || []).length} memories carry no in-game day. They are grouped under “Undated” rather than dropped. `
        + (bits.length ? bits.join('; ') + '. ' : '')
        + `The in-game clock elsewhere runs 0–1.3M, so sorting by <code>gt</code> without quarantining these throws them a thousandfold past the end.`
    });
  }
  if (prep.orphanCaps.length) {
    out.push({
      title: 'Captures with no day',
      body: `${plural(prep.orphanCaps.length, 'capture')} could not be matched to a day on the rail. `
        + `Capture days are parsed out of the <code>ts</code> string, whose format payloads.md never specifies, and the rail itself is built from the events table — `
        + `so a capture on an event-less day has nowhere to go.`
    });
  }
  if (prep.orphanMems.length) {
    out.push({
      title: 'Memories off the rail',
      body: `${plural(prep.orphanMems.length, 'memory').replace('memorys', 'memories')} carry a day label absent from <code>ordered_days</code>.`
    });
  }
  return out;
}

function noticesHtml() {
  return dataNotices().map(n => `<div class="quarantine"><b>${esc(n.title)}</b>${n.body}</div>`).join('');
}

/* ==========================================================================
   Shared render helpers
   ========================================================================== */

const gauge = (lbl, val, color) =>
  `<div class="gauge"><div class="gl"><span>${esc(lbl)}</span><span>${val}</span></div><div class="gbar"><i style="width:${val}%;background:${color}"></i></div></div>`;

const KCAT = { People: 'var(--gold)', Undead: 'var(--violet)', Wildlife: 'var(--moss)', Monsters: 'var(--steel)', Dragon: 'var(--blood)' };

const facInfo = {};
(IE.factions || []).forEach(f => facInfo[f.name] = f);
const FAC_PAL = ['var(--gold)', 'var(--steel)', 'var(--blood)', 'var(--moss)', 'var(--violet)', 'var(--amber)', '#6f8fa6', '#a2714f', '#7f9c7a'];
const facColor = {};
(IE.factions || []).forEach((f, i) => facColor[f.name] = FAC_PAL[i % FAC_PAL.length]);
const cFac = n => facColor[n] || 'var(--dim)';

/* Whisper classification — ported verbatim from the original (line 569). */
function classifyWhisper(text) {
  const t = (text || '').toLowerCase();
  const playerTerms = [String(SN.player || '').toLowerCase(), 'dragonborn', 'dovahkiin'].concat(topActorNames.map(n => n.toLowerCase()));
  const polTerms = [];
  (IE.factions || []).forEach(f => {
    polTerms.push(f.name.toLowerCase());
    (f.leaders || []).forEach(l => polTerms.push(l.toLowerCase()));
    if (f.hold) polTerms.push(f.hold.toLowerCase());
  });
  ['thalmor', 'stormcloak', 'imperial', 'legion', 'war', 'tariff', 'ulfric', 'tullius', 'elenwen', 'justiciar',
    'border', 'windhelm', 'solitude', 'markarth', 'skyrim', 'rebellion', 'nord soil', 'empire'].forEach(x => polTerms.push(x));
  const tags = [];
  if (playerTerms.some(p => p && t.includes(p))) tags.push('player');
  if (polTerms.some(p => p && t.includes(p))) tags.push('political');
  if (!tags.length) tags.push('personal');
  return tags;
}
const WTAG = {
  player:    { l: 'About ' + (SN.player || 'the player'), c: 'var(--gold)' },
  political: { l: 'Political', c: 'var(--steel)' },
  personal:  { l: 'Personal', c: 'var(--moss)' }
};

/* Highlight search hits without letting user text become markup: escape first, then wrap. */
function hl(text, q) {
  const e = esc(text);
  if (!q) return e;
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return e.replace(new RegExp('(' + safe + ')', 'ig'), '<mark>$1</mark>');
}

function memRow(m, q) {
  return `<div class="mrow">
    <div><div class="who" style="color:${colorFor(m.actor)}">${esc(m.actor)}</div>
      <div class="meta">${esc(m.type)}${m.emotion ? ' &middot; ' + esc(m.emotion) : ''}</div></div>
    <div><div class="mc">${hl(m.content, q)}</div><div class="mloc">${esc(m.location || '')}</div></div>
    <div class="impwrap"><span class="imptx">imp ${m.imp != null ? m.imp.toFixed(2) : '?'}</span>
      <div class="impbar"><i style="width:${Math.round((m.imp || 0) * 100)}%"></i></div></div>
  </div>`;
}

function captureCard(s, idx) {
  return `<div class="ocard" data-cap="${idx}" tabindex="0" role="button" aria-label="Open capture ${esc(s.name)}">
    ${s.img ? `<img loading="lazy" src="../omnisight-images/${esc(s.img)}" alt="${esc(s.name)}">` : ''}
    <div class="obody"><div class="on">${esc(s.name)}</div>
      <div class="om">${esc(s.loc || '')}${s.ts ? ' &middot; ' + esc(s.ts) : ''}</div>
      <div class="od">${esc(s.desc || '')}</div></div>
  </div>`;
}

/* ==========================================================================
   Lightbox — new; the original builds 163 <img> and ignores clicks on them.
   ========================================================================== */
function makeLightbox() {
  const el = document.createElement('div');
  el.className = 'lbox';
  el.innerHTML = `<button class="lx" aria-label="Close">&times;</button>
    <span class="lcount"></span>
    <button class="lnav lprev" aria-label="Previous">&#8249;</button>
    <img alt=""><div class="lcap"><div class="lname"></div><div class="lmeta"></div><div class="ldesc"></div></div>
    <button class="lnav lnext" aria-label="Next">&#8250;</button>`;
  document.body.appendChild(el);
  const img = el.querySelector('img'), nameEl = el.querySelector('.lname'),
    metaEl = el.querySelector('.lmeta'), descEl = el.querySelector('.ldesc'),
    countEl = el.querySelector('.lcount'),
    prev = el.querySelector('.lprev'), next = el.querySelector('.lnext');
  let list = [], i = 0, lastFocus = null;

  function show() {
    const s = list[i];
    if (!s) return;
    img.src = s.img ? '../omnisight-images/' + s.img : '';
    img.alt = s.name || '';
    nameEl.textContent = s.name || '';
    metaEl.textContent = [s.loc, s.ts].filter(Boolean).join(' · ');
    descEl.textContent = s.desc || '';
    countEl.textContent = (i + 1) + ' / ' + list.length;
    prev.disabled = i === 0;
    next.disabled = i === list.length - 1;
  }
  function open(arr, start) {
    list = arr; i = start; lastFocus = document.activeElement;
    el.classList.add('open'); show();
    el.querySelector('.lx').focus();
  }
  function close() {
    el.classList.remove('open');
    img.src = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  const step = d => { const n = i + d; if (n >= 0 && n < list.length) { i = n; show(); } };

  el.querySelector('.lx').addEventListener('click', close);
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  el.addEventListener('click', e => { if (e.target === el) close(); });
  document.addEventListener('keydown', e => {
    if (!el.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });
  return { open };
}

/* Wire a container of .ocard[data-cap] to the lightbox. `resolve` maps the index to the
 * capture list that card belongs to, so each view can open its own subset. */
function bindCaptures(container, lightbox, resolve) {
  const act = e => {
    const card = e.target.closest('.ocard');
    if (!card || !container.contains(card)) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    if (e.type === 'keydown') e.preventDefault();
    const { list, index } = resolve(parseInt(card.dataset.cap, 10));
    lightbox.open(list, index);
  };
  container.addEventListener('click', act);
  container.addEventListener('keydown', act);
}

/* ==========================================================================
   Constellation — ported from the original (lines 770-886), parameterised by
   container so each mockup can mount it where its shell wants it.
   ========================================================================== */
function makeConstellation(constelEl, tipEl, opts) {
  opts = opts || {};
  const CW = 1000, CH = 640, PAD = 40;
  let projMode = 'umap';
  let nodes = [], edgeEls = [], starEls = [], svg;
  let activeActor = '__all';
  let highlightDay = null;

  const mems = SN.memories || [];
  const projXY = m => projMode === 'umap' ? [m.ux, m.uy] : [m.x, m.y];

  function layoutHome() {
    nodes.forEach(nd => {
      const [px, py] = projXY(mems[nd.i]);
      nd.hx = PAD + px * (CW - 2 * PAD);
      nd.hy = PAD + py * (CH - 2 * PAD);
    });
  }
  function build() {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${CW} ${CH}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const gEdges = document.createElementNS(svg.namespaceURI, 'g');
    const gStars = document.createElementNS(svg.namespaceURI, 'g');
    svg.appendChild(gEdges); svg.appendChild(gStars);
    nodes = mems.map((m, i) => ({ i, x: 0, y: 0, vx: 0, vy: 0, hx: 0, hy: 0 }));
    layoutHome();
    nodes.forEach(nd => { nd.x = nd.hx; nd.y = nd.hy; });
    edgeEls = (SN.edges || []).map(([a, b, sim]) => {
      const ln = document.createElementNS(svg.namespaceURI, 'line');
      ln.setAttribute('stroke', 'var(--steel)');
      ln.setAttribute('stroke-opacity', (0.05 + (sim - 0.75) / 0.25 * 0.28).toFixed(3));
      ln.setAttribute('stroke-width', '0.7');
      gEdges.appendChild(ln);
      return { ln, a, b, rest: 0 };
    });
    edgeEls.forEach(e => { const A = nodes[e.a], B = nodes[e.b]; e.rest = Math.hypot(A.hx - B.hx, A.hy - B.hy) || 1; });
    starEls = nodes.map(nd => {
      const m = mems[nd.i];
      const c = document.createElementNS(svg.namespaceURI, 'circle');
      c.setAttribute('r', (2.2 + (m.imp || 0.5) * 5).toFixed(2));
      c.setAttribute('fill', colorFor(m.actor));
      c.setAttribute('class', 'cstar');
      c.setAttribute('fill-opacity', '0.9');
      c.__i = nd.i;
      gStars.appendChild(c);
      return c;
    });
    constelEl.appendChild(svg);
    paint(); bindStarEvents(); dim();
  }
  function paint() {
    nodes.forEach((nd, k) => { starEls[k].setAttribute('cx', nd.x.toFixed(1)); starEls[k].setAttribute('cy', nd.y.toFixed(1)); });
    edgeEls.forEach(e => {
      const A = nodes[e.a], B = nodes[e.b];
      e.ln.setAttribute('x1', A.x.toFixed(1)); e.ln.setAttribute('y1', A.y.toFixed(1));
      e.ln.setAttribute('x2', B.x.toFixed(1)); e.ln.setAttribute('y2', B.y.toFixed(1));
    });
  }
  function dim() {
    starEls.forEach(c => {
      const m = mems[c.__i];
      let on = activeActor === '__all' || m.actor === activeActor
        || (activeActor === '__others' && !topActorNames.includes(m.actor));
      if (on && highlightDay) on = (m.day === highlightDay);
      c.setAttribute('fill-opacity', on ? 0.92 : 0.08);
    });
    edgeEls.forEach(e => { e.ln.style.opacity = (activeActor === '__all' && !highlightDay) ? 1 : 0.25; });
  }
  /* physics */
  let dragNode = null, raf = null;
  function wake() { if (!raf && !RM) raf = requestAnimationFrame(step); }
  function step() {
    const kHome = 0.02, kEdge = 0.015, damp = 0.86;
    for (const nd of nodes) { if (nd === dragNode) continue; nd.vx += (nd.hx - nd.x) * kHome; nd.vy += (nd.hy - nd.y) * kHome; }
    for (const e of edgeEls) {
      const A = nodes[e.a], B = nodes[e.b];
      let dx = B.x - A.x, dy = B.y - A.y;
      const d = Math.hypot(dx, dy) || 1, f = (d - e.rest) / d * kEdge;
      const fx = dx * f, fy = dy * f;
      if (A !== dragNode) { A.vx += fx; A.vy += fy; }
      if (B !== dragNode) { B.vx -= fx; B.vy -= fy; }
    }
    let energy = 0;
    for (const nd of nodes) {
      if (nd === dragNode) continue;
      nd.vx *= damp; nd.vy *= damp; nd.x += nd.vx; nd.y += nd.vy;
      energy += nd.vx * nd.vx + nd.vy * nd.vy;
    }
    paint();
    if (energy < 0.02 && !dragNode) { raf = null; return; }
    raf = requestAnimationFrame(step);
  }
  function svgPt(evt) {
    const pt = svg.createSVGPoint(), t = evt.touches ? evt.touches[0] : evt;
    pt.x = t.clientX; pt.y = t.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function bindStarEvents() {
    starEls.forEach((c, k) => {
      c.addEventListener('pointerdown', e => { e.preventDefault(); dragNode = nodes[k]; c.setPointerCapture(e.pointerId); wake(); });
      c.addEventListener('pointermove', e => {
        if (dragNode === nodes[k]) { const p = svgPt(e); dragNode.x = p.x; dragNode.y = p.y; dragNode.vx = dragNode.vy = 0; paint(); if (!RM) wake(); }
        showTip(e, mems[c.__i]);
      });
      c.addEventListener('pointerup', () => { if (dragNode === nodes[k]) { dragNode = null; wake(); } });
      c.addEventListener('pointerenter', e => showTip(e, mems[c.__i]));
      c.addEventListener('pointerleave', () => { tipEl.style.opacity = 0; });
    });
  }
  function showTip(evt, m) {
    const rect = constelEl.getBoundingClientRect();
    tipEl.innerHTML = `<div class="cta" style="color:${colorFor(m.actor)}">${esc(m.actor)}</div>`
      + esc(m.content.slice(0, 160)) + (m.content.length > 160 ? '…' : '')
      + `<div class="ctm">${esc(m.type)}${m.emotion ? ' &middot; ' + esc(m.emotion) : ''}${m.day ? ' &middot; ' + esc(m.day) : ' &middot; undated'} &middot; imp ${m.imp != null ? m.imp.toFixed(2) : '?'}</div>`;
    let x = evt.clientX - rect.left + 14, y = evt.clientY - rect.top + 14;
    if (x > rect.width - 300) x = rect.width - 300;
    if (y > rect.height - 120) y = rect.height - 120;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px'; tipEl.style.opacity = 1;
  }
  function setProj(mode) {
    projMode = mode;
    layoutHome();
    nodes.forEach(nd => { nd.vx = nd.vy = 0; });
    edgeEls.forEach(ed => { const A = nodes[ed.a], B = nodes[ed.b]; ed.rest = Math.hypot(A.hx - B.hx, A.hy - B.hy) || 1; });
    if (RM) { nodes.forEach(nd => { nd.x = nd.hx; nd.y = nd.hy; }); paint(); } else wake();
  }
  const projNote = () => projMode === 'umap'
    ? 'UMAP projection (cosine metric) — the metric the mod’s memory recall actually uses.'
    : `PCA projection — top two components capture ${((SN.pca_var || 0) * 100).toFixed(1)}% of variance; a blurry linear shadow of the full space.`;

  build();
  return {
    setProj, projNote,
    setActor(a) { activeActor = a; dim(); },
    setDay(d) { highlightDay = d; dim(); },
    get proj() { return projMode; }
  };
}
