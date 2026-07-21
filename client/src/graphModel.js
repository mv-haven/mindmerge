// Pure graph helpers shared by every view (graph collapse, glossary, domains,
// analytics). Everything here is derived from the raw map: nodes[], links[].
// "Backbone" = the primary parentId tree; "edges" = backbone + link overlay.

// Map of parentId -> [childId] over backbone + links (the full DAG, child dir).
export function childrenMap(nodes, links = []) {
  const m = new Map();
  const push = (p, c) => {
    if (!m.has(p)) m.set(p, []);
    m.get(p).push(c);
  };
  for (const n of nodes) if (n.parentId) push(n.parentId, n.id);
  for (const l of links) push(l.parentId, l.childId);
  return m;
}

// Every node reachable downstream from id (children, grandchildren, …).
export function descendants(id, cmap) {
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    for (const c of cmap.get(stack.pop()) || []) {
      if (!out.has(c)) { out.add(c); stack.push(c); }
    }
  }
  return out;
}

// The top-level backbone root each node rolls up to (its "domain"), by walking
// primary parentId to the top. Returns Map nodeId -> rootId.
export function domainOf(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cache = new Map();
  const walk = (id, seen = new Set()) => {
    if (cache.has(id)) return cache.get(id);
    const n = byId.get(id);
    if (!n || !n.parentId || seen.has(id)) { cache.set(id, id); return id; }
    seen.add(id);
    const r = walk(n.parentId, seen);
    cache.set(id, r);
    return r;
  };
  const out = new Map();
  for (const n of nodes) out.set(n.id, walk(n.id));
  return out;
}

// The domain roots (backbone roots: no primary parent), sorted by subtree size.
export function domains(nodes, links = []) {
  const cmap = childrenMap(nodes, links);
  const roots = nodes.filter((n) => !n.parentId);
  return roots
    .map((r) => ({ node: r, size: descendants(r.id, cmap).size + 1 }))
    .sort((a, b) => b.size - a.size);
}

// Connection degree per node = distinct parents + children over backbone+links.
export function degreeMap(nodes, links = []) {
  const deg = new Map(nodes.map((n) => [n.id, 0]));
  const bump = (id) => deg.set(id, (deg.get(id) || 0) + 1);
  for (const n of nodes) if (n.parentId) { bump(n.id); bump(n.parentId); }
  for (const l of links) { bump(l.childId); bump(l.parentId); }
  return deg;
}

// Which nodes are visible given a collapsed set: a node is hidden if any
// ancestor on its PRIMARY (backbone) parent chain is collapsed. Keeps collapse
// intuitive (fold a branch) even though the graph is a DAG.
export function visibleIds(nodes, collapsed) {
  if (!collapsed || collapsed.size === 0) return new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const vis = new Set();
  for (const n of nodes) {
    let cur = n.parentId, hidden = false, guard = 0;
    while (cur && guard++ < 999) {
      if (collapsed.has(cur)) { hidden = true; break; }
      cur = byId.get(cur)?.parentId;
    }
    if (!hidden) vis.add(n.id);
  }
  return vis;
}

// Node ids that have at least one backbone child (i.e. are collapsible).
export function hasBackboneChildren(nodes) {
  const s = new Set();
  for (const n of nodes) if (n.parentId) s.add(n.parentId);
  return s;
}

// Domain-by-domain adjacency: count edges (backbone + link) whose endpoints sit
// in different domains. Returns { ids, labels, colors, matrix, totalCross }.
export function domainAdjacency(nodes, links = []) {
  const dom = domainOf(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rootIds = [...new Set([...dom.values()])];
  // order domains by subtree size, largest first
  const sized = domains(nodes, links).map((d) => d.node.id).filter((id) => rootIds.includes(id));
  const order = sized.length ? sized : rootIds;
  const idx = new Map(order.map((id, i) => [id, i]));
  const matrix = order.map(() => order.map(() => 0));
  let totalCross = 0;
  const edges = [];
  for (const n of nodes) if (n.parentId) edges.push([n.parentId, n.id]);
  for (const l of links) edges.push([l.parentId, l.childId]);
  for (const [a, b] of edges) {
    const da = dom.get(a), db = dom.get(b);
    if (da == null || db == null || da === db) continue;
    const i = idx.get(da), j = idx.get(db);
    if (i == null || j == null) continue;
    matrix[i][j] += 1;
    matrix[j][i] += 1; // symmetric view of cross-domain connectivity
    totalCross += 1;
  }
  return {
    ids: order,
    labels: order.map((id) => byId.get(id)?.text || id),
    colors: order.map((id) => byId.get(id)?.color || '#6366f1'),
    matrix,
    totalCross,
  };
}
