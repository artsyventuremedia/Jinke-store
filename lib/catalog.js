// Category tree. A category can sit under more than one parent (e.g. Caps under Apparels and Merchandise),
// and a parent's page lists the products of every category below it.
const { db } = require('./db');

function allCategories() {
  const parents = db.prepare('SELECT category_id, parent_id FROM category_parents').all();
  return db.prepare('SELECT * FROM categories ORDER BY sort, name').all().map((c) => ({
    ...c,
    parent_ids: parents.filter((p) => p.category_id === c.id).map((p) => p.parent_id),
  }));
}

// SQL fragment: ids of the category with this slug and everything below it. Bind the slug once.
const DESCENDANTS_SQL = `WITH RECURSIVE tree(id) AS (
    SELECT id FROM categories WHERE slug = ?
    UNION SELECT cp.category_id FROM category_parents cp JOIN tree ON cp.parent_id = tree.id
  ) SELECT id FROM tree`;

function descendantIds(categoryId) {
  return db.prepare(`WITH RECURSIVE tree(id) AS (
      SELECT ? UNION SELECT cp.category_id FROM category_parents cp JOIN tree ON cp.parent_id = tree.id
    ) SELECT id FROM tree`).all(categoryId).map((r) => r.id);
}

// Replaces a category's parents, refusing anything that would make a loop.
function setParents(categoryId, parentIds) {
  const below = new Set(descendantIds(categoryId));
  const ids = [...new Set((parentIds || []).map(Number).filter(Boolean))];
  for (const pid of ids) {
    if (below.has(pid)) {
      const err = new Error('A category cannot be placed under itself or one of its own sub-categories');
      err.status = 400;
      err.expose = true;
      throw err;
    }
  }
  db.prepare('DELETE FROM category_parents WHERE category_id = ?').run(categoryId);
  const ins = db.prepare('INSERT OR IGNORE INTO category_parents(category_id, parent_id) VALUES(?, ?)');
  for (const pid of ids) ins.run(categoryId, pid);
}

// Number of live products in each category, counting everything below it.
function withProductCounts(categories) {
  const direct = Object.fromEntries(db.prepare("SELECT category_id, COUNT(*) AS n FROM products WHERE status = 'active' GROUP BY category_id").all().map((r) => [r.category_id, r.n]));
  return categories.map((c) => ({ ...c, product_count: descendantIds(c.id).reduce((sum, id) => sum + (direct[id] || 0), 0) }));
}

module.exports = { allCategories, withProductCounts, DESCENDANTS_SQL, descendantIds, setParents };
