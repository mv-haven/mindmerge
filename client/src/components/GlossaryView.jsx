import { useMemo, useState } from 'react';
import { domainOf, degreeMap } from '../graphModel.js';

// A readable, filterable glossary of the committed standard: every agreed term
// with its domain, definition, aliases, and connection count. The graph's
// counterpart for actually looking something up.
export default function GlossaryView({ map, onOpenNode }) {
  const [q, setQ] = useState('');
  const [domainFilter, setDomainFilter] = useState(null);
  const [sort, setSort] = useState({ key: 'term', dir: 1 });

  const { rows, domainList } = useMemo(() => {
    if (!map) return { rows: [], domainList: [] };
    const committed = map.nodes.filter((n) => n.status === 'committed');
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const dom = domainOf(map.nodes);
    const deg = degreeMap(map.nodes, map.links);
    const rows = committed.map((n) => {
      const root = byId.get(dom.get(n.id));
      return {
        id: n.id,
        term: n.text,
        aliases: n.aliases || [],
        definition: n.description || '',
        connections: deg.get(n.id) || 0,
        domainId: root?.id,
        domain: root?.text || '—',
        color: root?.color || '#6366f1',
      };
    });
    const seen = new Map();
    for (const r of rows) if (r.domainId && !seen.has(r.domainId)) seen.set(r.domainId, { id: r.domainId, name: r.domain, color: r.color });
    const domainList = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { rows, domainList };
  }, [map]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (domainFilter && r.domainId !== domainFilter) return false;
      if (!needle) return true;
      return (
        r.term.toLowerCase().includes(needle) ||
        r.definition.toLowerCase().includes(needle) ||
        r.aliases.some((a) => a.toLowerCase().includes(needle))
      );
    });
    const { key, dir } = sort;
    out = [...out].sort((a, b) => {
      if (key === 'connections') return (a.connections - b.connections) * dir;
      return String(a[key]).localeCompare(String(b[key])) * dir;
    });
    return out;
  }, [rows, q, domainFilter, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '');

  return (
    <div className="view glossary">
      <div className="glossary__bar">
        <input
          className="glossary__search"
          placeholder="Search terms, definitions, aliases…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="glossary__chips">
          <button className={`chip ${!domainFilter ? 'chip--on' : ''}`} onClick={() => setDomainFilter(null)}>
            All <span className="chip__n">{rows.length}</span>
          </button>
          {domainList.map((d) => (
            <button
              key={d.id}
              className={`chip ${domainFilter === d.id ? 'chip--on' : ''}`}
              style={{ '--chip': d.color }}
              onClick={() => setDomainFilter(domainFilter === d.id ? null : d.id)}
            >
              <span className="chip__dot" style={{ background: d.color }} />
              {d.name} <span className="chip__n">{rows.filter((r) => r.domainId === d.id).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="glossary__scroll">
        <table className="glossary__table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort('term')}>Term{arrow('term')}</th>
              <th className="sortable" onClick={() => toggleSort('domain')}>Domain{arrow('domain')}</th>
              <th>Definition</th>
              <th>Also known as</th>
              <th className="sortable num" onClick={() => toggleSort('connections')}>Links{arrow('connections')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} onClick={() => onOpenNode(r.id)}>
                <td className="glossary__term">{r.term}</td>
                <td>
                  <span className="glossary__domain" style={{ '--chip': r.color }}>
                    <span className="chip__dot" style={{ background: r.color }} />
                    {r.domain}
                  </span>
                </td>
                <td className="glossary__def">{r.definition || <em className="muted">no definition yet</em>}</td>
                <td className="glossary__aka">{r.aliases.join(', ') || <span className="muted">—</span>}</td>
                <td className="num">{r.connections}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={5} className="glossary__empty">No terms match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="view__foot">{shown.length} of {rows.length} terms</div>
    </div>
  );
}
