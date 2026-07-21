import { useMemo } from 'react';
import { degreeMap, domainAdjacency, domainOf } from '../graphModel.js';

export default function AnalyticsView({ map, onOpenNode }) {
  const data = useMemo(() => {
    if (!map) return null;
    const nodes = map.nodes.filter((n) => n.status === 'committed');
    const ids = new Set(nodes.map((n) => n.id));
    const links = (map.links || []).filter((l) => ids.has(l.parentId) && ids.has(l.childId));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const dom = domainOf(nodes);

    const backboneEdges = nodes.filter((n) => n.parentId && ids.has(n.parentId)).length;
    const totalEdges = backboneEdges + links.length;
    const deg = degreeMap(nodes, links);
    const degs = [...deg.values()];
    const avg = degs.length ? degs.reduce((a, b) => a + b, 0) / degs.length : 0;

    const hubs = [...deg.entries()]
      .map(([id, d]) => ({ id, d, name: byId.get(id)?.text, color: byId.get(byId.get(id)?.parentId ? dom.get(id) : id)?.color || '#6366f1' }))
      .sort((a, b) => b.d - a.d)
      .slice(0, 10);
    const maxDeg = hubs[0]?.d || 1;

    const adj = domainAdjacency(nodes, links);
    // strongest cross-domain bridge
    let bridge = null;
    for (let i = 0; i < adj.matrix.length; i++)
      for (let j = i + 1; j < adj.matrix[i].length; j++)
        if (!bridge || adj.matrix[i][j] > bridge.n) bridge = { a: adj.labels[i], b: adj.labels[j], n: adj.matrix[i][j] };
    const maxCell = Math.max(1, ...adj.matrix.flat());

    return {
      tiles: [
        { k: 'Terms', v: nodes.length },
        { k: 'Connections', v: totalEdges },
        { k: 'Cross-domain links', v: adj.totalCross },
        { k: 'Avg links / term', v: avg.toFixed(1) },
        { k: 'Domains', v: adj.ids.length },
      ],
      bridge,
      hubs,
      maxDeg,
      adj,
      maxCell,
    };
  }, [map]);

  if (!data) return <div className="view analytics" />;
  const { tiles, bridge, hubs, maxDeg, adj, maxCell } = data;
  const heat = (n) => (n === 0 ? 'transparent' : `rgba(99,102,241,${0.12 + 0.88 * (n / maxCell)})`);

  return (
    <div className="view analytics">
      <div className="analytics__tiles">
        {tiles.map((t) => (
          <div className="stat" key={t.k}>
            <div className="stat__v">{t.v}</div>
            <div className="stat__k">{t.k}</div>
          </div>
        ))}
      </div>

      <div className="analytics__grid">
        <section className="panel">
          <h3 className="panel__h">Most connected terms</h3>
          <ul className="hubs">
            {hubs.map((h) => (
              <li key={h.id} className="hub" onClick={() => onOpenNode(h.id)}>
                <span className="hub__name">{h.name}</span>
                <span className="hub__bar"><span className="hub__fill" style={{ width: `${(h.d / maxDeg) * 100}%`, background: h.color }} /></span>
                <span className="hub__n">{h.d}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h3 className="panel__h">Cross-domain connectivity</h3>
          {bridge && bridge.n > 0 && (
            <p className="panel__note">Strongest bridge: <b>{bridge.a}</b> ↔ <b>{bridge.b}</b> ({bridge.n} edges)</p>
          )}
          <div className="matrix__scroll">
            <table className="matrix">
              <thead>
                <tr>
                  <th />
                  {adj.labels.map((l, j) => (
                    <th key={j} className="matrix__colh"><span>{l}</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {adj.matrix.map((row, i) => (
                  <tr key={i}>
                    <th className="matrix__rowh"><span className="chip__dot" style={{ background: adj.colors[i] }} />{adj.labels[i]}</th>
                    {row.map((n, j) => (
                      <td key={j} className={`matrix__cell ${i === j ? 'matrix__cell--diag' : ''}`}
                          style={{ background: i === j ? undefined : heat(n) }}
                          title={i === j ? '' : `${adj.labels[i]} ↔ ${adj.labels[j]}: ${n}`}>
                        {i === j ? '—' : n || ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
