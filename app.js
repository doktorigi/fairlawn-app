'use strict';
// Content lives in data/*.json (curated, researched) + data/feed.json (rebuilt by tools/update_feeds.py on a schedule).
const FILES = ['gov', 'schools', 'parks', 'local', 'clubs', 'events', 'community', 'living', 'more_local'];
const D = { contacts: [], guides: [], places: [], programs: [], events: [], businesses: [], community: [], feeds: [], clubs: [], datedEvents: [], faqs: [] };
let FEED = { news: [], events: [], errors: [] };
let COLLECTION = null;
const view = document.getElementById('view');
const mapwrap = document.getElementById('mapwrap');
const search = document.getElementById('search');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => isoDay(new Date());
const ext = (url, label) => safeUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${label}</a>` : '';

// localStorage can throw (private mode, blocked storage): the app must work without it
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not persisted */ } },
};
const favs = new Set(store.get('favs', []));
const star = key => `<button class="star${favs.has(key) ? ' on' : ''}" data-fav="${esc(key)}" aria-label="Save" aria-pressed="${favs.has(key)}">${favs.has(key) ? '★' : '☆'}</button>`;
document.addEventListener('click', e => {
  const b = e.target.closest('[data-fav]');
  if (!b) return;
  const k = b.dataset.fav;
  favs.has(k) ? favs.delete(k) : favs.add(k);
  store.set('favs', [...favs]);
  b.classList.toggle('on', favs.has(k)); b.textContent = favs.has(k) ? '★' : '☆'; b.setAttribute('aria-pressed', favs.has(k));
});

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

// ---------- calendar export ----------
function icsHref(e) {
  const fmt = s => s.length === 10 ? ';VALUE=DATE:' + s.replace(/-/g, '')
    : /Z$|[+-]\d\d:\d\d$/.test(s) ? ':' + new Date(s).toISOString().replace(/[-:]|\.\d+/g, '')
      : ':' + s.replace(/[-:]/g, '').slice(0, 15).padEnd(15, '0'); // floating local time
  const t = s => String(s || '').replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fair Lawn Guide//EN', 'BEGIN:VEVENT',
    `UID:${norm(e.title)}-${norm(e.start)}@fairlawn-guide`, `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}`,
    'DTSTART' + fmt(e.start), ...(e.end ? ['DTEND' + fmt(e.end)] : []), `SUMMARY:${t(e.title)}`,
    ...(e.location ? [`LOCATION:${t(e.location)}`] : []), ...(safeUrl(e.link) ? [`URL:${e.link}`] : []), 'END:VEVENT', 'END:VCALENDAR'];
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
}

// ---------- cards ----------
function contactCard(c) {
  const a = [];
  if (c.phone) a.push(`<a href="${telHref(c.phone)}">📞 ${esc(c.phone)}</a>`);
  if (c.email) a.push(`<a href="mailto:${esc(c.email)}">✉️ Email</a>`);
  a.push(ext(c.url, '🌐 Website'));
  if (c.address) a.push(`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">📍 Directions</a>`);
  return `<div class="card">${star('c:' + c.name)}<h3>${esc(c.name)}</h3>
    ${c.address ? `<div class="meta">${esc(c.address)}</div>` : ''}
    ${c.hours ? `<div class="meta">🕒 ${esc(c.hours)}</div>` : ''}
    ${c.notes ? `<p>${esc(c.notes)}</p>` : ''}
    <div class="actions">${a.join('')}</div></div>`;
}

function placeCard(p) {
  const a = [];
  if (typeof p.lat === 'number' && p.lat) a.push(`<a href="#map/${encodeURIComponent(p.name)}">🗺️ On map</a>`);
  if (p.phone) a.push(`<a href="${telHref(p.phone)}">📞 ${esc(p.phone)}</a>`);
  a.push(ext(p.url, '🌐 Website'));
  return `<div class="card">${star('p:' + p.name)}<h3>${esc(p.name)}</h3>
    <div class="meta">${esc([p.category, p.cuisine].filter(Boolean).join(' · '))}${p.address ? ' · ' + esc(p.address) : ''}</div>
    ${p.trending ? '<span class="tag hot">Trending</span>' : ''}${p.kosher ? '<span class="tag">Kosher</span>' : ''}
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
    ${e.description ? `<p>${esc(e.description)}</p>` : ''}
    <div class="meta">${esc(e.source || e.category || '')}</div>
    <div class="actions"><a href="${icsHref(e)}" download="${esc(norm(e.title).slice(0, 40) || 'event')}.ics">➕ Calendar</a></div></div>`;
}

const annualCard = e => `<div class="card"><h3>${esc(e.name)}</h3><div class="meta">${esc(e.when || '')}${e.where ? ' · ' + esc(e.where) : ''}</div>
  ${e.description ? `<p>${esc(e.description)}</p>` : ''}${safeUrl(e.url) ? `<div class="actions">${ext(e.url, '🌐 Details')}</div>` : ''}</div>`;

const programCard = p => `<div class="card">${star('g:' + p.name)}<h3>${esc(p.name)}</h3>
  <div class="meta">${[p.org, p.ages && 'Ages ' + p.ages.replace(/^ages\s*/i, ''), p.season].filter(Boolean).map(esc).join(' · ')}</div>
  ${p.description ? `<p>${esc(p.description)}</p>` : ''}
  <div class="actions">${ext(p.url, '🌐 Sign up / info')}${typeof p.lat === 'number' && p.lat ? `<a href="#map/${encodeURIComponent(p.name)}">🗺️ On map</a>` : ''}${p.contact ? `<span class="meta">${esc(p.contact)}</span>` : ''}</div></div>`;

const clubCard = c => `<div class="card">${star('k:' + c.name)}<h3>${esc(c.name)}</h3>
  <div class="meta">${esc([c.category, c.ages].filter(Boolean).join(' · '))}</div>
  ${c.description ? `<p>${esc(c.description)}</p>` : ''}
  ${c.meets ? `<div class="meta">🗓️ ${esc(c.meets)}${c.where ? ' · ' + esc(c.where) : ''}</div>` : c.where ? `<div class="meta">📍 ${esc(c.where)}</div>` : ''}
  ${c.join ? `<div class="meta">🙋 ${esc(c.join)}</div>` : ''}
  <div class="actions">${ext(c.url, '🌐 Website')}${c.email ? `<a href="mailto:${esc(c.email)}">✉️ Email</a>` : ''}${c.phone ? `<a href="${telHref(c.phone)}">📞 ${esc(c.phone)}</a>` : ''}</div></div>`;

const communityCard = c => `<div class="card"><h3>${safeUrl(c.url) ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</h3>
  <div class="meta">${esc(c.platform || '')}</div>${c.description ? `<p>${esc(c.description)}</p>` : ''}</div>`;

const guideCard = g => `<a class="card" style="display:block;text-decoration:none;color:inherit" href="#guide/${encodeURIComponent(g.id)}">
  <h3>${esc(g.title)}</h3><div class="meta">${esc(g.category || '')}</div></a>`;

const faqCard = f => `<details class="card"><summary><b>${esc(f.q)}</b></summary><p>${esc(f.a)}</p>
  ${safeUrl(f.source) ? `<div class="meta">Source: ${ext(f.source, esc(new URL(f.source).hostname))}</div>` : ''}</details>`;

// ---------- trash & recycling ----------
function pickups(section, from, days) {
  // ponytail: holiday shifts are shown as notes, not recomputed into the schedule
  const s = COLLECTION?.sections?.[section];
  if (!s) return [];
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from); d.setDate(d.getDate() + i);
    const dow = DAYS[d.getDay()], md = isoDay(d).slice(5), items = [];
    const summer = COLLECTION.summer && md >= COLLECTION.summer.from && md <= COLLECTION.summer.to;
    if (s.garbage === dow || (summer && s.summerGarbage === dow)) items.push('🗑️ Garbage');
    if (s.recycling === dow) {
      const weeks = Math.round((new Date(isoDay(d) + 'T12:00') - new Date(s.paperWeekOf + 'T12:00')) / 6048e5);
      items.push(s.paperWeekOf ? (weeks % 2 === 0 ? '📰 Paper & cardboard' : '🥫 Bottles & cans') : '♻️ Recycling');
      if (md >= '04-01' && md <= '12-18') items.push('🍂 Yard waste (bagged leaves)');
    }
    const day = isoDay(d);
    const notes = (COLLECTION.holidays || []).filter(h => h.date === day).map(h => '⚠️ ' + h.note)
      .concat((COLLECTION.special || []).filter(x => specialDay(x, section) === day).map(x => `📌 ${x.title}`));
    if (items.length || notes.length) out.push({ d, items, notes });
  }
  return out;
}

// multi-day specials list each section's own day in the note, e.g. "Sec 1 Wed 10/21"
function specialDay(x, section) {
  if (!x.end) return x.date;
  const m = (x.note || '').match(new RegExp(`Sec(?:tion)?\\s*${section}\\s+(?:[A-Za-z]{3}\\s+)?(\\d{1,2})/(\\d{1,2})`));
  return m ? `${x.date.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : x.date;
}

function sectionFor(street) {
  const t = norm(street);
  return (COLLECTION?.streets || []).filter(r => norm(r.street).startsWith(t));
}

function trash() {
  const sec = store.get('section', '');
  const rows = sec ? pickups(sec, new Date(), 14) : [];
  view.innerHTML = `<h1>Your pickup days</h1>
    <div class="card"><label for="street"><b>Find your section by street</b></label>
      <input id="street" class="input" placeholder="Start typing your street…" autocomplete="off">
      <div id="street-hits"></div>
      <div class="chips">${['1', '2', '3', '4', '5'].map(s => `<button data-sec="${s}" class="${s === sec ? 'on' : ''}">Section ${s}</button>`).join('')}</div>
      ${COLLECTION?.lookupUrl ? `<div class="meta">Not sure? ${ext(COLLECTION.lookupUrl, 'Official street list')}</div>` : ''}</div>
    ${sec ? `<h2>Next two weeks · Section ${esc(sec)}</h2>` + rows.map(r => `<div class="card"><h3>${r.d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
      ${r.items.map(i => `<div>${esc(i)}</div>`).join('')}${r.notes.map(n => `<div class="meta">${esc(n)}</div>`).join('')}</div>`).join('')
      + (COLLECTION.sections[sec].notes ? `<div class="banner">${esc(COLLECTION.sections[sec].notes)}</div>` : '') : '<div class="empty">Pick your section to see your schedule.</div>'}
    ${COLLECTION?.notes ? `<div class="banner">${esc(COLLECTION.notes)}</div>` : ''}
    ${findGuide(/garbage|recycl/i) ? `<p><a href="#guide/${encodeURIComponent(findGuide(/garbage|recycl/i).id)}">Full garbage & recycling guide →</a></p>` : ''}`;
  view.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { store.set('section', b.dataset.sec); trash(); });
  const input = document.getElementById('street'), hits = document.getElementById('street-hits');
  input.oninput = () => {
    const found = input.value.trim().length < 2 ? [] : sectionFor(input.value).slice(0, 8);
    hits.innerHTML = found.map(r => `<button class="btn" data-sec="${esc(r.section)}">${esc(r.street)}${r.range ? ' (' + esc(r.range) + ')' : ''} → Section ${esc(r.section)}</button>`).join(' ');
    hits.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { store.set('section', b.dataset.sec); trash(); });
  };
}

// ---------- weather (Open-Meteo, no key) ----------
const WX = [[0, '☀️', 'Clear'], [2, '⛅', 'Partly cloudy'], [3, '☁️', 'Cloudy'], [48, '🌫️', 'Fog'], [57, '🌦️', 'Drizzle'], [67, '🌧️', 'Rain'],
  [77, '🌨️', 'Snow'], [82, '🌧️', 'Showers'], [86, '🌨️', 'Snow showers'], [99, '⛈️', 'Thunderstorms']];
const wx = code => WX.find(w => code <= w[0]) || WX[0];
let weather;
async function loadWeather() {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=40.9404&longitude=-74.1182&current=temperature_2m,weather_code'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=4';
  try { weather = await fetch(url).then(r => r.json()); } catch { return; }
  const el = document.getElementById('wx');
  if (el) el.outerHTML = weatherHtml();
}
function weatherHtml() {
  if (!weather?.daily) return '<div id="wx"></div>';
  const d = weather.daily, c = weather.current;
  return `<div id="wx" class="card wx"><div class="wx-now"><span>${wx(c.weather_code)[1]}</span><b>${Math.round(c.temperature_2m)}°</b><span class="meta">${wx(c.weather_code)[2]}</span></div>
    <div class="wx-days">${d.time.map((t, i) => `<div><div class="meta">${i ? DAYS[fmtDay(t).getDay()] : 'Today'}</div>${wx(d.weather_code[i])[1]}
      <div>${Math.round(d.temperature_2m_max[i])}° <span class="meta">${Math.round(d.temperature_2m_min[i])}°</span></div>
      <div class="meta">💧${d.precipitation_probability_max[i] ?? 0}%</div></div>`).join('')}</div></div>`;
}

// ---------- views ----------
const state = { news: 'All', ev: 'All', guides: 'All', directory: 'All', explore: 'Businesses', biz: 'All', clubs: 'All', faq: 'All' };

function findGuide(re) { return D.guides.find(g => re.test(g.title) || re.test(g.id)); }

function allEvents() {
  const t = todayIso();
  const mine = D.datedEvents.filter(e => (e.end || e.start || '').slice(0, 10) >= t).map(e => ({ ...e, source: e.source || e.category }));
  return uniqBy([...FEED.events, ...mine].filter(e => e.start).sort((a, b) => a.start.localeCompare(b.start)),
    e => norm(e.title).slice(0, 40) + e.start.slice(0, 10));
}

function today() {
  const month = MONTHS[new Date().getMonth()];
  const sec = store.get('section', '');
  const next = sec ? pickups(sec, new Date(), 3) : [];
  const alerts = FEED.news.filter(n => n.category === 'Alerts' && n.date && Date.now() - new Date(n.date) < 3 * 864e5);
  const quick = [
    ['🗑️', 'Pickup days', '#trash'],
    ['🚨', 'Emergency & alerts', findGuide(/emergenc|alert/i)],
    ['🏫', 'Enroll in school', findGuide(/enrol/i)],
    ['🧩', 'Clubs & groups', '#clubs'],
    ['❓', 'Resident FAQ', '#faq'],
    ['📦', 'New resident', findGuide(/moving|new resident/i)],
  ].filter(q => q[2]).map(([i, t, g]) => `<a href="${typeof g === 'string' ? g : '#guide/' + encodeURIComponent(g.id)}"><span>${i}</span>${t}</a>`);
  const thisMonth = D.events.filter(e => (e.when || '').includes(month));
  const cats = ['All', ...new Set(FEED.news.map(n => n.category).filter(Boolean))];
  const news = FEED.news.filter(n => state.news === 'All' || n.category === state.news).slice(0, 30);
  view.innerHTML = `
    ${alerts.map(a => `<div class="card alert"><b>⚠️ ${safeUrl(a.link) ? `<a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a>` : esc(a.title)}</b><div class="meta">${esc(a.source)} · ${ago(a.date)}</div></div>`).join('')}
    ${weatherHtml()}
    ${next.length ? `<a class="card pickup" href="#trash"><b>Section ${esc(sec)} pickups</b>${next.map(r => `<div><span class="meta">${r.d.toLocaleDateString([], { weekday: 'short' })}:</span> ${esc(r.items.join(', ') || r.notes.join(', '))}</div>`).join('')}</a>`
      : `<a class="card pickup" href="#trash"><b>🗑️ What goes out this week?</b><div class="meta">Set your section once to see your pickups here.</div></a>`}
    <div class="quick">${quick.join('')}</div>
    <h2>Coming up</h2>${allEvents().filter(e => e.category !== 'Nearby').slice(0, 5).map(eventCard).join('')}<p><a href="#events">All events →</a></p>
    ${thisMonth.length ? `<h2>${month} traditions</h2>${thisMonth.map(annualCard).join('')}` : ''}
    <h2>Latest news</h2>
    ${chips('c-news', cats, state.news, v => { state.news = v; today(); })}
    <div class="list">${news.map(newsCard).join('') || '<div class="empty">No news loaded yet.</div>'}</div>
    ${FEED.updated ? `<div class="banner">Feeds refreshed ${ago(FEED.updated)} from ${new Set(FEED.news.concat(FEED.events).map(n => n.source)).size} sources.</div>` : ''}`;
  if (!weather) loadWeather();
}

function events() {
  const list = allEvents();
  const cats = ['All', 'This week', ...new Set(list.map(e => e.category).filter(Boolean))];
  const week = isoDay(new Date(Date.now() + 7 * 864e5));
  const shown = list.filter(e => state.ev === 'All' ? e.category !== 'Nearby' :(state.ev === 'This week' ? e.start.slice(0, 10) <= week : e.category === state.ev)).slice(0, 150);
  let last = '', html = '';
  for (const e of shown) {
    const m = fmtDay(e.start).toLocaleDateString([], { month: 'long', year: 'numeric' });
    if (m !== last) { html += `<h2>${m}</h2>`; last = m; }
    html += eventCard(e);
  }
  view.innerHTML = `<h1>Events</h1>${chips('c-ev', cats, state.ev, v => { state.ev = v; events(); })}
    ${html || '<div class="empty">No upcoming events in this category.</div>'}
    <h2>Every year in Fair Lawn</h2>${D.events.map(annualCard).join('')}`;
}

function guides(id) {
  if (id) {
    const g = D.guides.find(g => g.id === id);
    if (!g) { view.innerHTML = '<div class="empty">Guide not found.</div>'; return; }
    view.innerHTML = `<p><a href="#guides">← All guides</a></p><h1>${esc(g.title)}</h1><div class="meta">${esc(g.category || '')}</div>
      <div class="guide-body">${body(g.body)}</div>
      ${g.route?.length ? `<div class="actions"><a href="#map/route/${encodeURIComponent(g.id)}">🗺️ Show route on map</a></div>` : ''}
      ${g.sources?.length ? `<h2>Sources</h2><ul>${g.sources.filter(safeUrl).map(s => `<li>${ext(s, esc(new URL(s).hostname))}</li>`).join('')}</ul>` : ''}`;
    return;
  }
  const cats = ['All', ...new Set(D.guides.map(g => g.category).filter(Boolean))];
  view.innerHTML = `<h1>Guides</h1>${chips('c-guides', cats, state.guides, v => { state.guides = v; guides(); })}
    ${D.guides.filter(g => state.guides === 'All' || g.category === state.guides).map(guideCard).join('')}`;
}

function directory() {
  const cats = ['All', ...new Set(D.contacts.map(c => c.category).filter(Boolean))];
  view.innerHTML = `<h1>Contacts</h1>
    <div class="card"><h3>🚨 Emergency: police, fire, ambulance</h3><div class="actions"><a href="tel:911">📞 Call 911</a><a href="tel:988">💬 988 Crisis line</a></div></div>
    ${chips('c-dir', cats, state.directory, v => { state.directory = v; directory(); })}
    ${D.contacts.filter(c => state.directory === 'All' || c.category === state.directory).map(contactCard).join('')}`;
}

function clubs() {
  const cats = ['All', ...new Set(D.clubs.map(c => c.category).filter(Boolean))];
  view.innerHTML = `<h1>Clubs & groups</h1><p class="meta">${D.clubs.length} clubs, service groups, teams and volunteer crews.</p>
    ${chips('c-clubs', cats, state.clubs, v => { state.clubs = v; clubs(); })}
    ${D.clubs.filter(c => state.clubs === 'All' || c.category === state.clubs).map(clubCard).join('') || '<div class="empty">No clubs yet.</div>'}`;
}

function faq() {
  const cats = ['All', ...new Set(D.faqs.map(f => f.category).filter(Boolean))];
  view.innerHTML = `<h1>Resident FAQ</h1>${chips('c-faq', cats, state.faq, v => { state.faq = v; faq(); })}
    ${D.faqs.filter(f => state.faq === 'All' || f.category === state.faq).map(faqCard).join('') || '<div class="empty">No questions yet.</div>'}`;
}

function saved() {
  const pick = (prefix, arr, card) => arr.filter(x => favs.has(prefix + x.name)).map(card).join('');
  view.innerHTML = `<h1>Saved</h1>` + (pick('c:', D.contacts, contactCard) + pick('p:', D.places.concat(D.businesses), placeCard)
    + pick('k:', D.clubs, clubCard) + pick('g:', D.programs, programCard) || '<div class="empty">Tap ☆ on any contact, place, club or program to keep it here.</div>');
}

function more() {
  const tiles = [['📞', 'Contacts', '#directory'], ['🗑️', 'Pickup days', '#trash'], ['🧩', 'Clubs & groups', '#clubs'], ['🍽️', 'Businesses', '#explore/Businesses'],
    ['🎨', 'Programs & classes', '#explore/Programs'], ['💬', 'Community boards', '#explore/Community'], ['❓', 'Resident FAQ', '#faq'], ['★', 'Saved', '#saved']];
  view.innerHTML = `<h1>More</h1><div class="quick">${tiles.map(([i, t, h]) => `<a href="${h}"><span>${i}</span>${t}</a>`).join('')}</div>
    <div class="banner">Content researched from official borough, school, county and local sources; news and events refresh automatically every few hours. Spot something wrong? Check the linked official source.</div>`;
}

function explore(sub) {
  if (sub) state.explore = sub;
  const tabs = ['Businesses', 'Programs', 'Community'];
  let html = '';
  if (state.explore === 'Businesses') {
    const cats = ['All', 'Trending', 'Kosher', ...new Set(D.businesses.map(b => b.category).filter(Boolean))];
    const list = D.businesses.filter(b => state.biz === 'All' || (state.biz === 'Trending' ? b.trending : state.biz === 'Kosher' ? b.kosher : b.category === state.biz))
      .sort((a, b) => (b.trending ? 1 : 0) - (a.trending ? 1 : 0));
    const bizNews = FEED.news.filter(n => n.category === 'Business').slice(0, 5);
    html = `${bizNews.length ? `<h2>In the news</h2>${bizNews.map(newsCard).join('')}<h2>Local favorites</h2>` : ''}
      ${chips('c-biz', cats, state.biz, v => { state.biz = v; explore(); })}${list.map(placeCard).join('')}`;
  } else if (state.explore === 'Programs') html = D.programs.map(programCard).join('');
  else html = `<p class="meta">Where neighbors talk. Most of these need you to join or log in to read.</p>` + D.community.map(communityCard).join('');
  view.innerHTML = `<h1>${esc(state.explore)}</h1>${chips('c-exp', tabs, state.explore, v => { location.hash = '#explore/' + v; })}${html || '<div class="empty">Nothing here yet.</div>'}`;
}

function results(q) {
  const t = q.toLowerCase();
  const hit = o => JSON.stringify(o).toLowerCase().includes(t);
  const sec = (title, arr, card) => arr.length ? `<h2>${title}</h2>${arr.slice(0, 20).map(card).join('')}` : '';
  view.innerHTML = `<h1>“${esc(q)}”</h1>` + (
    sec('Guides', D.guides.filter(hit), guideCard) + sec('FAQ', D.faqs.filter(hit), faqCard) + sec('Contacts', D.contacts.filter(hit), contactCard) +
    sec('Clubs', D.clubs.filter(hit), clubCard) + sec('Places', D.places.filter(hit), placeCard) + sec('Businesses', D.businesses.filter(hit), placeCard) +
    sec('Programs', D.programs.filter(hit), programCard) + sec('Events', allEvents().filter(hit), eventCard) +
    sec('News', FEED.news.filter(hit), newsCard) || '<div class="empty">No matches.</div>');
}

// ---------- map ----------
let map, layers = {}, markers = {}, routeLine;
// first matching group wins, so order matters
const MAP_GROUPS = { 'Food & shops': /^biz:/, 'Kids & classes': /^prog:|childcare/i, 'Worship': /worship/i, 'Health & help': /health|social|pets/i,
  'Parks & play': /park|playground|trail|pool|recreation|dog/i, 'Schools': /school/i, 'Transit': /transit/i, 'History': /landmark|histor/i,
  'Town services': /./ };
const COLORS = { 'Food & shops': '#e08a1e', 'Kids & classes': '#d6418f', 'Worship': '#5a6acf', 'Health & help': '#c62f4a', 'Parks & play': '#2e8b57',
  'Schools': '#2f6fd0', 'Transit': '#d0402f', 'History': '#8a5a2b', 'Town services': '#7b4fc9' };
const groupOf = cat => Object.keys(MAP_GROUPS).find(g => MAP_GROUPS[g].test(cat));
const shown = new Set(Object.keys(MAP_GROUPS).filter(g => g !== 'Worship' && g !== 'Kids & classes'));

function initMap() {
  map = L.map('map').setView([40.9387, -74.1176], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  for (const g in MAP_GROUPS) { layers[g] = L.layerGroup(); if (shown.has(g)) layers[g].addTo(map); }
  const all = D.places.map(p => [p, p.category || '']).concat(D.businesses.map(b => [b, 'biz:' + b.category]), D.programs.map(p => [p, 'prog:']));
  for (const [p, cat] of all) {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || !p.lat) continue;
    const dir = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
    const g = groupOf(cat);
    const m = L.circleMarker([p.lat, p.lng], { radius: 9, color: '#fff', weight: 2, fillColor: COLORS[g], fillOpacity: .95 }).bindTooltip(esc(p.name)).bindPopup(`<b>${esc(p.name)}</b><br><span class="meta">${esc(p.category || p.org || '')}</span>
      ${p.address ? '<br>' + esc(p.address) : ''}${p.description || p.note ? `<p>${esc(p.description || p.note)}</p>` : ''}
      ${(p.amenities || []).map(x => `<span class="tag">${esc(x)}</span>`).join('')}
      <div class="actions"><a href="${dir}" target="_blank" rel="noopener">Directions</a>${p.phone ? `<a href="${telHref(p.phone)}">Call</a>` : ''}${ext(p.url, 'Website')}</div>`);
    m.addTo(layers[g]);
    markers[norm(p.name)] = m;
  }
  const el = document.getElementById('chips-map');
  const draw = () => {
    el.innerHTML = Object.keys(MAP_GROUPS).filter(g => layers[g].getLayers().length).map(g => `<button data-g="${g}" class="${shown.has(g) ? 'on' : ''}"><span style="color:${COLORS[g]}">●</span> ${g}</button>`).join('');
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
    if (g && !shown.has(g)) { shown.add(g); map.addLayer(layers[g]); document.querySelector(`#chips-map [data-g="${g}"]`)?.classList.add('on'); }
    map.setView(m.getLatLng(), 17);
    m.openPopup();
  }
}

// ---------- router ----------
const ROUTES = { today, events, guides, guide: guides, directory, explore, clubs, faq, trash, saved, more };
const TAB_OF = { guide: 'guides', directory: 'more', explore: 'more', clubs: 'more', faq: 'more', trash: 'more', saved: 'more' };
function route() {
  const [tab, ...rest] = (location.hash.slice(1) || 'today').split('/');
  const arg = rest.length ? decodeURIComponent(rest.join('/')) : '';
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === (TAB_OF[tab] || tab)));
  mapwrap.hidden = true;
  view.hidden = tab === 'map';
  if (tab === 'map') return showMap(arg);
  if (search.value.trim()) search.value = '';
  (ROUTES[tab] || today)(arg);
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
  for (const p of parts) {
    for (const k in D) if (Array.isArray(p[k])) D[k].push(...p[k]);
    if (p.collection) COLLECTION = p.collection;
  }
  D.contacts = uniqBy(D.contacts, c => norm(c.name) + norm(c.phone));
  D.places = uniqBy(D.places, p => norm(p.name));
  D.businesses = uniqBy(D.businesses, b => norm(b.name));
  D.programs = uniqBy(D.programs, p => norm(p.name));
  D.clubs = uniqBy(D.clubs, c => norm(c.name));
  D.events = uniqBy(D.events, e => norm(e.name));
  D.guides = uniqBy(D.guides, g => g.id);
  try { FEED = await fetch('data/feed.json', { cache: 'no-cache' }).then(r => r.json()); } catch { /* offline + never cached: static content still works */ }
  window.addEventListener('hashchange', route);
  route();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
load();
