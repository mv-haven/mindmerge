// In-memory store with JSON-file persistence.
// Used for local development so the app runs with zero external services.
// Data lives in data/store.json and is rewritten (debounced) on every mutation.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_FILE is overridable (used by the e2e suite to isolate its store).
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', '..', 'data', 'store.json');
const DATA_DIR = path.dirname(DATA_FILE);

// Normalized text key for duplicate detection: trim, lowercase, collapse runs
// of whitespace. Keep this identical to the one in postgres.js.
export function normalizeText(t) {
  return (t || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function createMemoryStore({ threshold }) {
  // Shape: maps[id], nodes[id], votes[nodeId] = Set(voterId)
  const state = { maps: {}, nodes: {}, votes: {} };
  let saveTimer = null;

  async function load() {
    try {
      const raw = await fs.readFile(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      state.maps = parsed.maps || {};
      state.nodes = parsed.nodes || {};
      state.votes = {};
      for (const [nodeId, voters] of Object.entries(parsed.votes || {})) {
        state.votes[nodeId] = new Set(voters);
      }
    } catch {
      // No file yet — start empty.
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const serialisable = {
        maps: state.maps,
        nodes: state.nodes,
        votes: Object.fromEntries(
          Object.entries(state.votes).map(([k, set]) => [k, [...set]])
        ),
      };
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(serialisable, null, 2));
    }, 150);
  }

  function countVotes(nodeId) {
    return state.votes[nodeId]?.size || 0;
  }

  function shapeNode(node) {
    return { ...node, upvotes: countVotes(node.id) };
  }

  return {
    threshold,

    async init() {
      await load();
    },

    async listMaps() {
      return Object.values(state.maps).sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : 1
      );
    },

    async getMap(mapId) {
      const map = state.maps[mapId];
      if (!map) return null;
      const nodes = Object.values(state.nodes)
        .filter((n) => n.mapId === mapId)
        .map(shapeNode);
      return { ...map, nodes };
    },

    async createMap({ title }) {
      const id = nanoid(10);
      const now = new Date().toISOString();
      state.maps[id] = { id, title: title || 'Untitled map', createdAt: now };
      // Every map is born with a committed root node.
      const rootId = nanoid(10);
      state.nodes[rootId] = {
        id: rootId,
        mapId: id,
        parentId: null,
        text: title || 'Master map',
        color: '#4338ca',
        status: 'committed',
        createdAt: now,
        committedAt: now,
        authorId: 'system',
        x: null,
        y: null,
      };
      scheduleSave();
      return this.getMap(id);
    },

    async createProposal({ mapId, parentId, text, color, authorId, asAdmin }) {
      if (!state.maps[mapId]) throw new Error('map-not-found');
      // parentId null/empty => a new unconnected (root/island) node.
      const parent = parentId || null;
      if (parent) {
        const p = state.nodes[parent];
        if (!p || p.mapId !== mapId) throw new Error('parent-not-found');
        if (p.status !== 'committed') throw new Error('parent-not-committed');
      }

      // Anti-duplication: compare against siblings sharing the same parent.
      const key = normalizeText(text);
      const siblings = Object.values(state.nodes).filter(
        (n) => n.mapId === mapId && (n.parentId || null) === parent
      );
      if (siblings.some((n) => n.status === 'committed' && normalizeText(n.text) === key)) {
        throw new Error('duplicate-committed');
      }
      const dup = siblings.find((n) => n.status === 'proposed' && normalizeText(n.text) === key);
      if (dup) {
        // An admin "creating" a node that matches a pending proposal just
        // commits that proposal; everyone else folds into an upvote for it.
        if (asAdmin) {
          const node = await this.adminCommit({ nodeId: dup.id });
          return { node, merged: true, committed: true };
        }
        const { node, committed } = await this.vote({ nodeId: dup.id, voterId: authorId || 'anon' });
        return { node, merged: true, committed };
      }

      const now = new Date().toISOString();
      const id = nanoid(10);
      const node = {
        id,
        mapId,
        parentId: parent,
        text: (text || '').trim() || 'Untitled',
        color: color || '#0ea5e9',
        // Admins author straight into the master map; everyone else proposes.
        status: asAdmin ? 'committed' : 'proposed',
        createdAt: now,
        committedAt: asAdmin ? now : null,
        authorId: authorId || 'anon',
        x: null,
        y: null,
      };
      state.nodes[id] = node;
      state.votes[id] = new Set();
      scheduleSave();
      return { node: shapeNode(node), merged: false, committed: Boolean(asAdmin) };
    },

    async deleteNode({ nodeId }) {
      const node = state.nodes[nodeId];
      if (!node) throw new Error('node-not-found');
      const mapId = node.mapId;
      // Cascade: remove the node and its whole subtree.
      const toDelete = [];
      const stack = [nodeId];
      while (stack.length) {
        const cur = stack.pop();
        toDelete.push(cur);
        for (const n of Object.values(state.nodes)) {
          if (n.parentId === cur) stack.push(n.id);
        }
      }
      for (const id of toDelete) {
        delete state.nodes[id];
        delete state.votes[id];
      }
      scheduleSave();
      return { mapId, deleted: toDelete.length };
    },

    async reparent({ nodeId, newParentId }) {
      const node = state.nodes[nodeId];
      if (!node) throw new Error('node-not-found');
      const target = newParentId || null;
      if (target) {
        if (target === nodeId) throw new Error('cannot-parent-to-self');
        const p = state.nodes[target];
        if (!p || p.mapId !== node.mapId) throw new Error('parent-not-found');
        if (p.status !== 'committed') throw new Error('parent-not-committed');
        // Cycle guard: the new parent must not be a descendant of the node.
        const descendants = new Set();
        const stack = [nodeId];
        while (stack.length) {
          const cur = stack.pop();
          for (const n of Object.values(state.nodes)) {
            if (n.parentId === cur && !descendants.has(n.id)) {
              descendants.add(n.id);
              stack.push(n.id);
            }
          }
        }
        if (descendants.has(target)) throw new Error('would-create-cycle');
      }
      node.parentId = target;
      scheduleSave();
      return shapeNode(node);
    },

    async vote({ nodeId, voterId }) {
      const node = state.nodes[nodeId];
      if (!node) throw new Error('node-not-found');
      if (node.status !== 'proposed') return { node: shapeNode(node), committed: false };
      state.votes[nodeId] = state.votes[nodeId] || new Set();
      state.votes[nodeId].add(voterId);
      let committed = false;
      if (countVotes(nodeId) >= threshold) {
        node.status = 'committed';
        node.committedAt = new Date().toISOString();
        committed = true;
      }
      scheduleSave();
      return { node: shapeNode(node), committed };
    },

    async adminCommit({ nodeId }) {
      const node = state.nodes[nodeId];
      if (!node) throw new Error('node-not-found');
      if (node.status !== 'committed') {
        node.status = 'committed';
        node.committedAt = new Date().toISOString();
      }
      scheduleSave();
      return shapeNode(node);
    },

    async setPosition({ nodeId, x, y }) {
      const node = state.nodes[nodeId];
      if (!node) throw new Error('node-not-found');
      node.x = x;
      node.y = y;
      scheduleSave();
      return shapeNode(node);
    },

    async dismiss({ nodeId }) {
      const node = state.nodes[nodeId];
      if (!node) throw new Error('node-not-found');
      if (node.status === 'committed') throw new Error('cannot-dismiss-committed');
      const mapId = node.mapId;
      // Remove the proposal and any (proposed) descendants defensively.
      delete state.nodes[nodeId];
      delete state.votes[nodeId];
      scheduleSave();
      return { nodeId, mapId };
    },

    async getActivity(mapId) {
      return Object.values(state.nodes)
        .filter((n) => n.mapId === mapId && n.status === 'committed' && n.parentId)
        .sort((a, b) => (a.committedAt < b.committedAt ? 1 : -1))
        .slice(0, 30)
        .map((n) => ({
          id: n.id,
          text: n.text,
          parentText: state.nodes[n.parentId]?.text || '(root)',
          committedAt: n.committedAt,
        }));
    },
  };
}
