const { db, getSettings } = require('./db');
const DEFAULT_PAGES = require('./default-pages');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Adds any missing policy pages; never overwrites ones the admin has edited.
async function seedPages() {
  for (const p of DEFAULT_PAGES) await db.run('INSERT OR IGNORE INTO pages(slug, title, body) VALUES(?, ?, ?)', p.slug, p.title, p.body);
}

async function placeholders() {
  const s = await getSettings();
  return {
    ...s,
    business_name: s.business_name || s.store_name,
    grievance_officer: s.grievance_officer || `Customer Care, ${s.store_name}`,
  };
}

// Turns the simple page format into HTML: "## " headings, "- " bullet lists, blank lines between paragraphs.
// A line whose {placeholder} is empty in Settings is left out (e.g. no GSTIN yet).
async function renderBody(body) {
  const vals = await placeholders();
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

async function getPage(slug) {
  const page = (await db.get('SELECT slug, title, body, updated_at FROM pages WHERE slug = ?', slug));
  if (!page) return null;
  return { ...page, html: await renderBody(page.body) };
}

module.exports = { seedPages, renderBody, getPage };
