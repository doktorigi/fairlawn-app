'use strict';
// Content lives in data/*.json (curated, researched) + data/feed.json (rebuilt by tools/update_feeds.py on a schedule).
const FILES = ['gov', 'schools', 'parks', 'local'];
const D = { contacts: [], guides: [], places: [], programs: [], events: [], businesses: [], community: [], feeds: [] };
let FEED = { news: [], events: [], errors: [] };
const view = document.getElementById('view');
const mapwrap = document.getElementById('mapwrap');
const search = document.getElementById('search');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uniqBy = (arr, key) => { const seen = new Set(); return arr.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
const telHref = p => 'tel:' + String(p).replace(/[^\d+]/g, '').slice(0, 15);
const ago = iso => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 60 ? `${Math.max(m, 1)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const fmtDay = iso => new Date(iso.length === 10 ? iso + 'T12:00' : iso);

function body(text) {
  // guide bodies: blank line = paragraph, "- " lines = bullets
  return String(text || '').split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    if (lines.every(l => l.trim().startsWith('- ')))
      return '<ul>' + lines.map(l => `<li>${esc(l.trim().slice(2))}</li>`).join('') + '</ul>';
    return lines.map(l => l.trim().startsWith('- ') ? `<ul><li>${esc(l.trim().slice(2))}</li></ul>` : `<p>${esc(l)}</p>`).join('');
  }).join('');
}

function chips(id, options, current, onPick) {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelectorAll('button').forEach(b => b.onclick = () => onPick(b.dataset.v));
  });
  return `<div class="chips" id="${id}">${options.map(o => `<button data-v="${esc(o)}" class="${o === current ? 'on' : ''}">${esc(o)}</button>`).join('')}</div>`;
}

// ---------- cards ----------
function contactCard(c) {
  const a = [];
  if (c.phone) a.push(`<a href="${telHref(c.phone)}">📞 ${esc(c.phone)}</a>`);
  if (c.email) a.push(`<a href="mailto:${esc(c.email)}">✉️ Email</a>`);
  if (safeUrl(c.url)) a.push(`<a href="${esc(c.url)}" target="_blank" rel="noopener">🌐 Website</a>`);
  if (c.address) a.push(`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">📍 Directions</a>`);
  return `<div class="card"><h3>${esc(c.name)}</h3>
    ${c.address ? `<div class="meta">${esc(c.address)}</div>` : ''}
    ${c.hours ? `<div class="meta">🕒 ${esc(c.hours)}</div>` : ''}
    ${c.notes ? `<p>${esc(c.notes)}</p>` : ''}
    <div class="actions">${a.join('')}</div></div>`;
}

function placeCard(p) {
  const a = [`<a href="#map/${encodeURIComponent(p.name)}">🗺️ On map</a>`];
  if (p.phone) a.push(`<a href="${telHref(p.phone)}">📞 ${esc(p.phone)}</a>`);
  if (safeUrl(p.url)) a.push(`<a href="${esc(p.url)}" target="_blank" rel="noopener">🌐 Website</a>`);
  return `<div class="card"><h3>${esc(p.name)}</h3>
    <div class="meta">${esc(p.category || '')}${p.address ? ' · ' + esc(p.address) : ''}</div>
    ${p.trending ? '<span class="tag hot">Trending</span>' : ''}
    ${(p.amenities || []).map(x => `<span class="tag">${esc(x)}</span>`).join('')}
    ${p.description || p.note ? `<p>${esc(p.description || p.note)}</p>` : ''}
    <div class="actions">${a.join('')}</div></div>`;
}

function newsCard(n) {
  const link = safeUrl(n.link);
  return `<div class="card"><h3>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)}</h3>
    <div class="meta">${esc(n.source)}${n.date ? ' · ' + ago(n.date) : ''}</div>
    ${n.summary ? `<p>${esc(n.summary)}</p>` : ''}</div>`;
}

function eventCard(e) {
  const d = fmtDay(e.start);
  const time = e.start.length > 10 ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'All day';
  const link = safeUrl(e.link);
  return `<div class="card clear"><div class="date-badge"><small>${d.toLocaleDateString([], { month: 'short' })}</small><b>${d.getDate()}</b></div>
    <h3>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</h3>
    <div class="meta">${d.toLocaleDateString([], { weekday: 'short' })} · ${time}${e.location ? ' · ' + esc(e.location) : ''}</div>
    <div class="meta">${esc(e.source)}</div></div>`;
}

const annualCard = e => `<div class="card"><h3>${esc(e.name)}</h3><div class="meta">${esc(e.when || '')}${e.where ? ' · ' + esc(e.where) : ''}</div>
  ${e.description ? `<p>${esc(e.description)}</p>` : ''}${safeUrl(e.url) ? `<div class="actions"><a href="${esc(e.url)}" target="_blank" rel="noopener">🌐 Details</a></div>` : ''}</div>`;

const programCard = p => `<div class="card"><h3>${esc(p.name)}</h3>
  <div class="meta">${[p.org, p.ages && 'Ages ' + p.ages.replace(/^ages\s*/i, ''), p.season].filter(Boolean).map(esc).join(' · ')}</div>
  ${p.description ? `<p>${esc(p.description)}</p>` : ''}
  <div class="actions">${safeUrl(p.url) ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">🌐 Sign up / info</a>` : ''}${p.contact ? `<span class="meta">${esc(p.contact)}</span>` : ''}</div></div>`;

const communityCard = c => `<div class="card"><h3>${safeUrl(c.url) ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</h3>
  <div class="meta">${esc(c.platform || '')}</div>${c.description ? `<p>${esc(c.description)}</p>` : ''}</div>`;

const guideCard = g => `<a class="card" style="display:block;text-decoration:none;color:inherit" href="#guide/${encodeURIComponent(g.id)}">
  <h3>${esc(g.title)}</h3><div class="meta">${esc(g.category || '')}</div></a>`;

// ---------- views ----------
const state = { news: 'All', ev: 'All', guides: 'All', directory: 'All', explore: 'Businesses', biz: 'All' };

function findGuide(re) { return D.guides.find(g => re.test(g.title) || re.test(g.id)); }

function today() {
  const month = MONTHS[new Date().getMonth()];
  const quick = [
    ['🗑️', 'Garbage & recycling', findGuide(/garbage|recycl|trash/i)],
    ['🚨', 'Emergency & alerts', findGuide(/emergenc|alert/i)],
    ['🏫', 'Enroll in school', findGuide(/enrol/i)],
    ['🏊', 'Summer & pool', findGuide(/summer|pool/i)],
    ['🚆', 'Getting around', findGuide(/transit|getting around/i)],
    ['📦', 'New resident', findGuide(/moving|new resident/i)],
  ].filter(q => q[2]).map(([i, t, g]) => `<a href="#guide/${encodeURIComponent(g.id)}"><span>${i}</span>${t}</a>`);
  const thisMonth = D.events.filter(e => (e.when || '').includes(month));
  const cats = ['All', ...new Set(FEED.news.map(n => n.category).filter(Boolean))];
  const news = FEED.news.filter(n => state.news === 'All' || n.category === state.news).slice(0, 30);
  const evCats = ['All', ...new Set(FEED.events.map(e => e.category).filter(Boolean))];
  const evs = FEED.events.filter(e => state.ev === 'All' || e.category === state.ev).slice(0, 10);
  view.innerHTML = `
    <div class="quick">${quick.join('')}<a href="#map"><span>🌳</span>Parks map</a><a href="#directory"><span>📞</span>All contacts</a></div>
    ${FEED.events.length ? `<h2>Coming up</h2>${chips('c-ev', evCats, state.ev, v => { state.ev = v; today(); })}${evs.map(eventCard).join('')}` : ''}
    ${thisMonth.length ? `<h2>${month} traditions</h2>${thisMonth.map(annualCard).join('')}` : ''}
    <h2>Latest news</h2>
    ${chips('c-news', cats, state.news, v => { state.news = v; today(); })}
    <div class="list">${news.map(newsCard).join('') || '<div class="empty">No news loaded yet.</div>'}</div>
    ${FEED.updated ? `<div class="banner">Feeds refreshed ${ago(FEED.updated)} from ${new Set(FEED.news.concat(FEED.events).map(n => n.source)).size} sources.</div>` : ''}`;
}

function guides(id) {
  if (id) {
    const g = D.guides.find(g => g.id === id);
    if (!g) { view.innerHTML = '<div class="empty">Guide not found.</div>'; return; }
    view.innerHTML = `<p><a href="#guides">← All guides</a></p><h1>${esc(g.title)}</h1><div class="meta">${esc(g.category || '')}</div>
      <div class="guide-body">${body(g.body)}</div>
      ${g.route?.length ? `<div class="actions"><a href="#map/route/${encodeURIComponent(g.id)}">🗺️ Show route on map</a></div>` : ''}
      ${g.sources?.length ? `<h2>Sources</h2><ul>${g.sources.filter(safeUrl).map(s => `<li><a href="${esc(s)}" target="_blank" rel="noopener">${esc(new URL(s).hostname)}</a></li>`).join('')}</ul>` : ''}`;
    return;
  }
  const cats = ['All', ...new Set(D.guides.map(g => g.category).filter(Boolean))];
  view.innerHTML = `<h1>Guides</h1>${chips('c-guides', cats, state.guides, v => { state.guides = v; guides(); })}
    ${D.guides.filter(g => state.guides === 'All' || g.category === state.guides).map(guideCard).join('')}`;
}

function directory() {
  const cats = ['All', ...new Set(D.contacts.map(c => c.category).filter(Boolean))];
  view.innerHTML = `<h1>Contacts</h1>
    <div class="card"><h3>🚨 Emergency: police, fire, ambulance</h3><div class="actions"><a href="tel:911">📞 Call 911</a></div></div>
    ${chips('c-dir', cats, state.directory, v => { state.directory = v; directory(); })}
    ${D.contacts.filter(c => state.directory === 'All' || c.category === state.directory).map(contactCard).join('')}`;
}

function explore(sub) {
  if (sub) state.explore = sub;
  const tabs = ['Businesses', 'Programs', 'Events', 'Community'];
  let html = '';
  if (state.explore === 'Businesses') {
    const cats = ['All', 'Trending', ...new Set(D.businesses.map(b => b.category).filter(Boolean))];
    const list = D.businesses.filter(b => state.biz === 'All' || (state.biz === 'Trending' ? b.trending : b.category === state.biz))
      .sort((a, b) => (b.trending ? 1 : 0) - (a.trending ? 1 : 0));
    const bizNews = FEED.news.filter(n => n.category === 'Business').slice(0, 5);
    html = `${bizNews.length ? `<h2>In the news</h2>${bizNews.map(newsCard).join('')}<h2>Local favorites</h2>` : ''}
      ${chips('c-biz', cats, state.biz, v => { state.biz = v; explore(); })}${list.map(placeCard).join('')}`;
  } else if (state.explore === 'Programs') html = D.programs.map(programCard).join('');
  else if (state.explore === 'Events') html = `<p class="meta">Annual traditions. Dated events are on the Today tab.</p>` + D.events.map(annualCard).join('');
  else html = `<p class="meta">Where neighbors talk. Most of these need you to join or log in to read.</p>` + D.community.map(communityCard).join('');
  view.innerHTML = `<h1>Explore</h1>${chips('c-exp', tabs, state.explore, v => { location.hash = '#explore/' + v; })}${html || '<div class="empty">Nothing here yet.</div>'}`;
}

function results(q) {
  const t = q.toLowerCase();
  const hit = o => JSON.stringify(o).toLowerCase().includes(t);
  const sec = (title, arr, card) => arr.length ? `<h2>${title}</h2>${arr.slice(0, 20).map(card).join('')}` : '';
  view.innerHTML = `<h1>“${esc(q)}”</h1>` + (
    sec('Guides', D.guides.filter(hit), guideCard) + sec('Contacts', D.contacts.filter(hit), contactCard) +
    sec('Places', D.places.filter(hit), placeCard) + sec('Businesses', D.businesses.filter(hit), placeCard) +
    sec('Programs', D.programs.filter(hit), programCard) + sec('News', FEED.news.filter(hit), newsCard) +
    sec('Events', FEED.events.filter(hit), eventCard) || '<div class="empty">No matches.</div>');
}

// ---------- map ----------
let map, layers = {}, markers = {}, routeLine;
const MAP_GROUPS = { 'Parks & play': /park|playground|trail|pool|recreation|dog/i, 'Schools': /school/i, 'Town services': /government|library|recycl|safety/i,
  'Transit': /transit/i, 'History': /landmark|histor/i, 'Food & shops': /^biz:/ };
const COLORS = { 'Parks & play': '#2e8b57', 'Schools': '#2f6fd0', 'Town services': '#7b4fc9', 'Transit': '#d0402f', 'History': '#8a5a2b', 'Food & shops': '#e08a1e' };
const groupOf = cat => Object.keys(MAP_GROUPS).find(g => MAP_GROUPS[g].test(cat)) || 'Town services';
const shown = new Set(Object.keys(MAP_GROUPS));

function initMap() {
  map = L.map('map').setView([40.9387, -74.1176], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  for (const g in MAP_GROUPS) layers[g] = L.layerGroup().addTo(map);
  const all = D.places.map(p => [p, p.category]).concat(D.businesses.map(b => [b, 'biz:' + b.category]));
  for (const [p, cat] of all) {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || !p.lat) continue;
    const dir = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
    const g = groupOf(cat);
    const m = L.circleMarker([p.lat, p.lng], { radius: 9, color: '#fff', weight: 2, fillColor: COLORS[g], fillOpacity: .95 }).bindTooltip(esc(p.name)).bindPopup(`<b>${esc(p.name)}</b><br><span class="meta">${esc(p.category || '')}</span>
      ${p.address ? '<br>' + esc(p.address) : ''}${p.description || p.note ? `<p>${esc(p.description || p.note)}</p>` : ''}
      ${(p.amenities || []).map(x => `<span class="tag">${esc(x)}</span>`).join('')}
      <div class="actions"><a href="${dir}" target="_blank" rel="noopener">Directions</a>${p.phone ? `<a href="${telHref(p.phone)}">Call</a>` : ''}${safeUrl(p.url) ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">Website</a>` : ''}</div>`);
    m.addTo(layers[g]);
    markers[norm(p.name)] = m;
  }
  const el = document.getElementById('chips-map');
  const draw = () => {
    el.innerHTML = Object.keys(MAP_GROUPS).map(g => `<button data-g="${g}" class="${shown.has(g) ? 'on' : ''}"><span style="color:${COLORS[g]}">●</span> ${g}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.onclick = () => {
      const g = b.dataset.g;
      shown.has(g) ? (shown.delete(g), map.removeLayer(layers[g])) : (shown.add(g), map.addLayer(layers[g]));
      draw();
    });
  };
  draw();
}

function showMap(arg) {
  mapwrap.hidden = false;
  if (!map) initMap();
  setTimeout(() => map.invalidateSize());
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  if (arg?.startsWith('route/')) {
    const g = D.guides.find(g => g.id === arg.slice(6));
    if (g?.route?.length) {
      routeLine = L.polyline(g.route, { color: '#c8862a', weight: 5 }).addTo(map).bindPopup(esc(g.title));
      map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
    }
  } else if (arg && markers[norm(arg)]) {
    const m = markers[norm(arg)];
    const g = Object.keys(layers).find(k => layers[k].hasLayer(m));
    if (g && !shown.has(g)) { shown.add(g); map.addLayer(layers[g]); }
    map.setView(m.getLatLng(), 17);
    m.openPopup();
  }
}

// ---------- router ----------
function route() {
  const [tab, ...rest] = (location.hash.slice(1) || 'today').split('/');
  const arg = rest.length ? decodeURIComponent(rest.join('/')) : '';
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === (tab === 'guide' ? 'guides' : tab)));
  mapwrap.hidden = true;
  view.hidden = tab === 'map';
  if (tab === 'map') return showMap(arg);
  if (search.value.trim()) search.value = '';
  ({ today, guides, guide: guides, directory, explore }[tab] || today)(arg);
  window.scrollTo(0, 0);
}

let searchTimer;
search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = search.value.trim();
    if (!q) return route();
    mapwrap.hidden = true; view.hidden = false;
    results(q);
  }, 200);
});

async function load() {
  const parts = await Promise.all(FILES.map(f => fetch(`data/${f}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}))));
  for (const p of parts) for (const k in D) if (Array.isArray(p[k])) D[k].push(...p[k]);
  D.contacts = uniqBy(D.contacts, c => norm(c.name) + norm(c.phone));
  D.places = uniqBy(D.places, p => norm(p.name));
  D.guides = uniqBy(D.guides, g => g.id);
  try { FEED = await fetch('data/feed.json', { cache: 'no-cache' }).then(r => r.json()); } catch { /* offline + never cached: static content still works */ }
  window.addEventListener('hashchange', route);
  route();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
load();
