import { memo, useContext } from 'react';
import { Handle, Position } from '@xyflow/react';
import { MapActions } from '../MapActions.js';

// A single mind-map node. Committed nodes are solid and can spawn proposals.
// Proposed nodes are dashed and show a vote tally + (for admins) merge/dismiss.
function MindNode({ data }) {
  const actions = useContext(MapActions);
  const { threshold, isAdmin, hasVoted } = actions;
  const proposed = data.status === 'proposed';
  const voted = hasVoted(data.id);

  const moving = actions.reorgIds?.includes(data.id);
  const collapsible = actions.collapsibleSet?.has(data.id);
  const isCollapsed = actions.collapsedSet?.has(data.id);
  const hiddenCount = actions.subtreeCounts?.get(data.id) || 0;

  return (
    <div
      className={`node ${proposed ? 'node--proposed' : 'node--committed'} ${moving ? 'node--moving' : ''} ${isCollapsed ? 'node--collapsed' : ''}`}
      style={proposed ? undefined : { '--accent': data.color }}
    >
      <Handle type="target" position={Position.Left} />
      {collapsible && (
        <button
          className="node__collapse nodrag"
          onClick={(e) => { e.stopPropagation(); actions.onToggleCollapse(data.id); }}
          title={isCollapsed ? `Expand ${hiddenCount} hidden` : 'Collapse subtree'}
        >
          {isCollapsed ? `▸ ${hiddenCount}` : '▾'}
        </button>
      )}
      <div className="node__text">{data.text}</div>
      {data.aliases?.length > 0 && (
        <div className="node__aka">aka {data.aliases.join(', ')}</div>
      )}

      {proposed ? (
        <div className="node__proposal">
          <button
            className={`vote nodrag ${voted ? 'vote--done' : ''}`}
            onClick={() => actions.onVote(data.id)}
            disabled={voted}
            title={voted ? 'You already upvoted this' : 'Upvote to help it merge'}
          >
            ▲ {data.upvotes}/{threshold}
          </button>
          {isAdmin && (
            <span className="node__admin">
              <button className="mini mini--commit nodrag" onClick={() => actions.onCommit(data.id)}>
                Commit
              </button>
              <button className="mini mini--dismiss nodrag" onClick={() => actions.onDismiss(data.id)}>
                Dismiss
              </button>
            </span>
          )}
        </div>
      ) : (
        <div className="node__committedbar">
          <button className="node__add nodrag" onClick={() => actions.onPropose(data.id)}>
            {isAdmin ? '+ add child' : '+ propose'}
          </button>
          {isAdmin && (
            <span className="node__admin">
              <button
                className="mini mini--move nodrag"
                onClick={() => actions.onStartReorg([data.id], `“${data.text}”`)}
              >
                Move
              </button>
              <button
                className="mini mini--dismiss nodrag"
                onClick={() => actions.onDelete(data.id, data.text)}
              >
                Delete
              </button>
            </span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default memo(MindNode);
