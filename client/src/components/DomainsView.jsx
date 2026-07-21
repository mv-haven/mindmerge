import { useMemo, useState } from 'react';
import { domains, domainOf } from '../graphModel.js';

const W = 1000, H = 620, PAD = 4, HEADER = 22;

// Squarified treemap of one rectangle over value-weighted items.
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((s, it) => s + it.value, 0);
  if (total <= 0 || w <= 1 || h <= 1) return out;
  const scale = (w * h) / total;
  const scaled = items
    .map((it) => ({ ...it, area: it.value * scale }))
    .sort((a, b) => b.area - a.area);
  let rect = { x, y, w, h };
  const worst = (row, len) => {
    const a = row.map((it) => it.area);
    const sum = a.reduce((p, q) => p + q, 0);
    const mx = Math.max(...a), mn = Math.min(...a), l2 = len * len, s2 = sum * sum;
    return Math.max((l2 * mx) / s2, s2 / (l2 * mn));
  };
  let i = 0;
  while (i < scaled.length) {
    const row = [scaled[i]];
    let next = i + 1;
    while (next < scaled.length) {
      const side = Math.min(rect.w, rect.h);
      if (worst([...row, scaled[next]], side) > worst(row, side)) break;
      row.push(scaled[next]);
      next++;
    }
    const rowArea = row.reduce((s, it) => s + it.area, 0);
    if (rect.w <= rect.h) {
      const rh = rowArea / rect.w;
      let cx = rect.x;
      for (const it of row) { const cw = it.area / rh; out.push({ ...it, x: cx, y: rect.y, w: cw, h: rh }); cx += cw; }
      rect = { x: rect.x, y: rect.y + rh, w: rect.w, h: rect.h - rh };
    } else {
      const rw = rowArea / rect.h;
      let cy = rect.y;
      for (const it of row) { const ch = it.area / rw; out.push({ ...it, x: rect.x, y: cy, w: rw, h: ch }); cy += ch; }
      rect = { x: rect.x + rw, y: rect.y, w: rect.w - rw, h: rect.h };
    }
    i = next;
  }
  return out;
}

const fit = (s, w) => (s.length * 7 > w - 10 ? s.slice(0, Math.max(0, Math.floor((w - 14) / 7))) + '…' : s);

export default function DomainsView({ map, onOpenNode }) {
  const [focusId, setFocusId] = useState(null); // null = all domains; else drilled into a node

  const model = useMemo(() => {
    if (!map) return null;
    const nodes = map.nodes.filter((n) => n.status === 'committed');
    const ids = new Set(nodes.map((n) => n.id));
    const links = (map.links || []).filter((l) => ids.has(l.parentId) && ids.has(l.childId));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const backboneKids = new Map();
    for (const n of nodes) if (n.parentId && byId.has(n.parentId)) {
      if (!backboneKids.has(n.parentId)) backboneKids.set(n.parentId, []);
      backboneKids.get(n.parentId).push(n);
    }
    const dom = domainOf(nodes);
    // Size = node + its BACKBONE descendants, matching what you can drill into.
    const sizeMemo = new Map();
    const sizeOf = (id) => {
      if (sizeMemo.has(id)) return sizeMemo.get(id);
      let n = 1;
      for (const k of backboneKids.get(id) || []) n += sizeOf(k.id);
      sizeMemo.set(id, n);
      return n;
    };
    const colorOf = (id) => byId.get(dom.get(id))?.color || '#6366f1';
    return { nodes, byId, backboneKids, sizeOf, colorOf,
      domainRoots: domains(nodes, links).map((d) => d.node) };
  }, [map]);

  const { cells, crumbs, legend, focusNode } = useMemo(() => {
    if (!model) return { cells: [], crumbs: [], legend: [], focusNode: null };
    const { byId, backboneKids, sizeOf, colorOf, domainRoots } = model;
    const focusNode = focusId ? byId.get(focusId) : null;
    // Regions = children of the focus, or the domain roots at the top level.
    const regions = focusId ? (backboneKids.get(focusId) || []) : domainRoots;

    const outer = squarify(
      regions.map((n) => ({ id: n.id, node: n, value: sizeOf(n.id) })),
      PAD, PAD, W - 2 * PAD, H - 2 * PAD
    );
    const cells = [];
    for (const region of outer) {
      const color = colorOf(region.node.id);
      const kids = backboneKids.get(region.node.id) || [];
      cells.push({ kind: 'domain', id: region.node.id, label: region.node.text, count: region.value, color, hasKids: kids.length > 0, x: region.x, y: region.y, w: region.w, h: region.h });
      if (!kids.length || region.h < HEADER + 14 || region.w < 30) continue;
      const inner = squarify(
        kids.map((k) => ({ id: k.id, node: k, value: sizeOf(k.id) })),
        region.x + PAD, region.y + HEADER, region.w - 2 * PAD, region.h - HEADER - PAD
      );
      for (const t of inner) {
        const tKids = backboneKids.get(t.node.id) || [];
        cells.push({ kind: 'tile', id: t.node.id, label: t.node.text, count: t.value, color, hasKids: tKids.length > 0, x: t.x, y: t.y, w: t.w, h: t.h });
      }
    }

    // Breadcrumbs: Home / domain / … / focus
    const crumbs = [];
    let cur = focusId;
    while (cur) { const n = byId.get(cur); if (!n) break; crumbs.unshift(n); cur = n.parentId; }

    const legend = domainRoots.map((n) => ({ id: n.id, name: n.text, color: colorOf(n.id) }));
    return { cells, crumbs, legend, focusNode };
  }, [model, focusId]);

  // Click: drill into a box that has children; a leaf opens on the graph.
  const onCell = (c) => (c.hasKids ? setFocusId(c.id) : onOpenNode(c.id));

  if (!model) return <div className="view domains" />;

  return (
    <div className="view domains">
      <div className="domains__bar">
        <nav className="crumbs">
          <button className={`crumb ${!focusId ? 'crumb--on' : ''}`} onClick={() => setFocusId(null)}>All domains</button>
          {crumbs.map((n) => (
            <span key={n.id} className="crumb__wrap">
              <span className="crumb__sep">▸</span>
              <button className={`crumb ${n.id === focusId ? 'crumb--on' : ''}`} onClick={() => setFocusId(n.id)}>{n.text}</button>
            </span>
          ))}
        </nav>
        {focusNode && (
          <button className="ghostbtn ghostbtn--sm" onClick={() => onOpenNode(focusNode.id)}>Open on graph →</button>
        )}
      </div>

      {!focusId && (
        <div className="domains__legend">
          {legend.map((d) => (
            <button key={d.id} className="chip" style={{ '--chip': d.color }} onClick={() => setFocusId(d.id)}>
              <span className="chip__dot" style={{ background: d.color }} />
              {d.name}
            </button>
          ))}
        </div>
      )}

      <div className="domains__canvas">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="treemap">
          <g key={focusId || 'root'} className="treemap__enter">
            {cells.map((c) =>
              c.kind === 'domain' ? (
                <g key={`d-${c.id}`} className={c.hasKids ? 'treemap__domaing' : ''} onClick={() => onCell(c)}>
                  <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="6" className="treemap__domain" style={{ stroke: c.color }} />
                  {c.w > 60 && (
                    <text x={c.x + 8} y={c.y + 15} className="treemap__domainlabel" style={{ fill: c.color }}>
                      {fit(c.label, c.w - 44)} <tspan className="treemap__domaincount">{c.count}{c.hasKids ? ' ▸' : ''}</tspan>
                    </text>
                  )}
                </g>
              ) : (
                <g key={`t-${c.id}`} className="treemap__tileg" onClick={() => onCell(c)}>
                  <rect x={c.x + 1} y={c.y + 1} width={Math.max(0, c.w - 2)} height={Math.max(0, c.h - 2)} rx="4"
                        className="treemap__tile" style={{ fill: c.color }} />
                  {c.w > 34 && c.h > 16 && (
                    <text x={c.x + 6} y={c.y + 15} className="treemap__tilelabel">{fit(c.label + (c.hasKids ? '  ▸' : ''), c.w)}</text>
                  )}
                </g>
              )
            )}
          </g>
        </svg>
      </div>
      <div className="view__foot">Area ∝ terms in each branch · click a box with ▸ to drill in · a leaf opens on the graph</div>
    </div>
  );
}
