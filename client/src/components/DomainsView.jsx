import { useMemo } from 'react';
import { childrenMap, descendants, domains } from '../graphModel.js';

const W = 1000, H = 620, PAD = 4, HEADER = 22;

// Squarified treemap of one rectangle over value-weighted items (sorted desc).
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
  const { cells, legend } = useMemo(() => {
    if (!map) return { cells: [], legend: [] };
    const nodes = map.nodes.filter((n) => n.status === 'committed');
    const links = (map.links || []).filter((l) => {
      const s = new Set(nodes.map((n) => n.id));
      return s.has(l.parentId) && s.has(l.childId);
    });
    const cmap = childrenMap(nodes, links);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const backboneKids = new Map();
    for (const n of nodes) if (n.parentId && byId.has(n.parentId)) {
      if (!backboneKids.has(n.parentId)) backboneKids.set(n.parentId, []);
      backboneKids.get(n.parentId).push(n);
    }
    const sizeOf = (id) => descendants(id, cmap).size + 1; // node + all descendants

    const doms = domains(nodes, links); // [{node, size}] sorted desc
    const outer = squarify(
      doms.map((d) => ({ id: d.node.id, node: d.node, value: d.size })),
      PAD, PAD, W - 2 * PAD, H - 2 * PAD
    );

    const cells = [];
    const legend = [];
    for (const region of outer) {
      const color = region.node.color || '#6366f1';
      legend.push({ id: region.node.id, name: region.node.text, color, size: region.value });
      cells.push({ kind: 'domain', id: region.node.id, label: region.node.text, count: region.value, color, x: region.x, y: region.y, w: region.w, h: region.h });
      // sub-tiles = direct children (area ∝ their own subtree size); leaves get size 1
      const kids = backboneKids.get(region.node.id) || [];
      if (!kids.length || region.h < HEADER + 14 || region.w < 30) continue;
      const inner = squarify(
        kids.map((k) => ({ id: k.id, node: k, value: sizeOf(k.id) })),
        region.x + PAD, region.y + HEADER, region.w - 2 * PAD, region.h - HEADER - PAD
      );
      for (const t of inner) {
        cells.push({ kind: 'tile', id: t.node.id, label: t.node.text, count: t.value, color, x: t.x, y: t.y, w: t.w, h: t.h });
      }
    }
    return { cells, legend };
  }, [map]);

  return (
    <div className="view domains">
      <div className="domains__legend">
        {legend.map((d) => (
          <button key={d.id} className="chip" style={{ '--chip': d.color }} onClick={() => onOpenNode(d.id)}>
            <span className="chip__dot" style={{ background: d.color }} />
            {d.name} <span className="chip__n">{d.count}</span>
          </button>
        ))}
      </div>
      <div className="domains__canvas">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="treemap">
          {cells.map((c) =>
            c.kind === 'domain' ? (
              <g key={`d-${c.id}`}>
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="6" className="treemap__domain" style={{ stroke: c.color }} />
                {c.w > 60 && (
                  <text x={c.x + 8} y={c.y + 15} className="treemap__domainlabel" style={{ fill: c.color }}>
                    {fit(c.label, c.w - 40)} <tspan className="treemap__domaincount">{c.count}</tspan>
                  </text>
                )}
              </g>
            ) : (
              <g key={`t-${c.id}`} className="treemap__tileg" onClick={() => onOpenNode(c.id)}>
                <rect x={c.x + 1} y={c.y + 1} width={Math.max(0, c.w - 2)} height={Math.max(0, c.h - 2)} rx="4"
                      className="treemap__tile" style={{ fill: c.color }} />
                {c.w > 34 && c.h > 16 && (
                  <text x={c.x + 6} y={c.y + 15} className="treemap__tilelabel">{fit(c.label, c.w)}</text>
                )}
              </g>
            )
          )}
        </svg>
      </div>
      <div className="view__foot">Area ∝ number of terms in each branch · click any tile to open it on the graph</div>
    </div>
  );
}
