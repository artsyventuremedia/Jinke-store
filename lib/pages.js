const { db, getSettings } = require('./db');
const DEFAULT_PAGES = require('./default-pages');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Adds any missing policy pages; never overwrites ones the admin has edited.
function seedPages() {
  const ins = db.prepare('INSERT OR IGNORE INTO pages(slug, title, body) VALUES(?, ?, ?)');
  for (const p of DEFAULT_PAGES) ins.run(p.slug, p.title, p.body);
}

function placeholders() {
  const s = getSettings();
  return {
    ...s,
    business_name: s.business_name || s.store_name,
    grievance_officer: s.grievance_officer || `Customer Care, ${s.store_name}`,
  };
}

// Turns the simple page format into HTML: "## " headings, "- " bullet lists, blank lines between paragraphs.
// A line whose {placeholder} is empty in Settings is left out (e.g. no GSTIN yet).
function renderBody(body) {
  const vals = placeholders();
  const lines = String(body).split('\n')
    .filter((line) => !/\{(\w+)\}/.test(line) || [...line.matchAll(/\{(\w+)\}/g)].every(([, k]) => !(k in vals) || String(vals[k]).trim()))
    .map((line) => esc(line).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? esc(vals[k]) : m)));
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.join(' ')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<ul>${list.map((li) => `<li>${li}</li>`).join('')}</ul>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    if (line.startsWith('## ')) { flushPara(); flushList(); out.push(`<h2>${line.slice(3)}</h2>`); continue; }
    if (line.startsWith('- ')) { flushPara(); (list ||= []).push(line.slice(2)); continue; }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('\n');
}

function getPage(slug) {
  const page = db.prepare('SELECT slug, title, body, updated_at FROM pages WHERE slug = ?').get(slug);
  if (!page) return null;
  return { ...page, html: renderBody(page.body) };
}

module.exports = { seedPages, renderBody, getPage };
