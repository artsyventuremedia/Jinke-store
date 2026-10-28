// Category tree. A category can sit under more than one parent (e.g. Caps under Apparels and Merchandise),
// and a parent's page lists the products of every category below it.
const { db } = require('./db');

async function allCategories() {
  const parents = (await db.all('SELECT category_id, parent_id FROM category_parents'));
  return (await db.all('SELECT * FROM categories ORDER BY sort, name')).map((c) => ({
    ...c,
    parent_ids: parents.filter((p) => p.category_id === c.id).map((p) => p.parent_id),
  }));
}

// SQL fragment: ids of the category with this slug and everything below it. Bind the slug once.
const DESCENDANTS_SQL = `WITH RECURSIVE tree(id) AS (
    SELECT id FROM categories WHERE slug = ?
    UNION SELECT cp.category_id FROM category_parents cp JOIN tree ON cp.parent_id = tree.id
  ) SELECT id FROM tree`;

async function descendantIds(categoryId) {
  return (await db.all(`WITH RECURSIVE tree(id) AS (
      SELECT ? UNION SELECT cp.category_id FROM category_parents cp JOIN tree ON cp.parent_id = tree.id
    ) SELECT id FROM tree`, categoryId)).map((r) => r.id);
}

// Replaces a category's parents, refusing anything that would make a loop.
async function setParents(categoryId, parentIds) {
  const below = new Set(await descendantIds(categoryId));
  const ids = [...new Set((parentIds || []).map(Number).filter(Boolean))];
  for (const pid of ids) {
    if (below.has(pid)) {
      const err = new Error('A category cannot be placed under itself or one of its own sub-categories');
      err.status = 400;
      err.expose = true;
      throw err;
    }
  }
  (await db.run('DELETE FROM category_parents WHERE category_id = ?', categoryId));
  for (const pid of ids) await db.run('INSERT OR IGNORE INTO category_parents(category_id, parent_id) VALUES(?, ?)', categoryId, pid);
}

// Number of live products in each category, counting everything below it.
// Worked out in memory from the parent links (one query instead of one per category).
async function withProductCounts(categories) {
  const direct = Object.fromEntries((await db.all("SELECT category_id, COUNT(*) AS n FROM products WHERE status = 'active' GROUP BY category_id")).map((r) => [r.category_id, r.n]));
  const below = (id, seen = new Set()) => {
    if (seen.has(id)) return seen;
    seen.add(id);
    for (const c of categories) if (c.parent_ids.includes(id)) below(c.id, seen);
    return seen;
  };
  return categories.map((c) => ({ ...c, product_count: [...below(c.id)].reduce((sum, id) => sum + (direct[id] || 0), 0) }));
}

module.exports = { allCategories, withProductCounts, DESCENDANTS_SQL, descendantIds, setParents };
