import React from 'react';
import { type Automaton } from '../lib/types.ts';
import { buildTransitionTable, type TransitionTableData } from '../lib/core/transitionTable.ts';
import { getSymbolColor, getSymbolColorDim } from '../lib/alphabetColors.ts';

interface TransitionTableProps {
  automaton: Automaton;
  /** State currently lit up by the live simulator trace or a stage preview,
   * so the table can highlight the same row Graph View is highlighting. */
  activeState?: string | null;
}

export const TransitionTable: React.FC<TransitionTableProps> = ({ automaton, activeState = null }) => {
  // Build the transition table data
  let data: TransitionTableData | undefined;
  let errorMsg = null;

  try {
    data = buildTransitionTable(automaton);
  } catch (err: any) {
    errorMsg = err.message || 'Failed to construct transition table';
  }

  if (errorMsg || !data) {
    return (
      <div style={{ padding: '1rem', color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', fontSize: '0.875rem', fontFamily: 'var(--font-sans)' }}>
        <strong>Error building transition table:</strong> {errorMsg}
      </div>
    );
  }

  // Cell formatting helper
  const formatCell = (targets: string[]): string => {
    if (targets.length === 0) {
      return '—'; // Placeholder for empty transition
    }
    if (targets.length === 1) {
      return targets[0]; // Single target state
    }
    return `{${targets.join(', ')}}`; // Multi-target NFA/ENFA states
  };

  return (
    <div className="table-view-container" style={{ width: '100%', height: '100%', overflow: 'auto', padding: '1rem' }}>
      {/* Component-level scoped style definitions */}
      <style>{`
        .transition-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 0.5rem;
          color: var(--text);
          background: rgba(30, 41, 59, 0.4);
          border-radius: 8px;
          border: 1px solid var(--panel-border);
          font-family: var(--font-mono);
        }
        .transition-table th, .transition-table td {
          border: 1px solid var(--panel-border);
          padding: 0.75rem;
          text-align: center;
          font-family: var(--font-mono);
          font-size: 0.9rem;
        }
        .transition-table th {
          background-color: rgba(15, 23, 42, 0.6);
          color: var(--primary);
          font-weight: 600;
        }
        .transition-table th.symbol-col {
          border-bottom-width: 3px;
        }
        .transition-table tr:hover {
          background-color: rgba(59, 130, 246, 0.05);
        }
        .transition-table tr.active-row {
          background-color: rgba(250, 204, 21, 0.1);
        }
        .transition-table tr.active-row td:first-child {
          color: #facc15;
        }
        .badge-marker {
          font-weight: bold;
          font-size: 0.75rem;
          padding: 0.2rem 0.5rem;
          border-radius: 4px;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-family: var(--font-mono);
        }
        .badge-start {
          background: rgba(59, 130, 246, 0.15);
          color: #60a5fa;
          border: 1px solid rgba(59, 130, 246, 0.3);
          margin-right: 0.25rem;
        }
        .badge-accept {
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }
      `}</style>

      <table className="transition-table">
        <thead>
          <tr>
            <th>State</th>
            <th>Type</th>
            {data.columns.map(col => (
              <th
                key={col}
                className="symbol-col"
                style={{ color: getSymbolColor(col), borderBottomColor: getSymbolColor(col) }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map(row => (
            <tr key={row.state} className={activeState === row.state ? 'active-row' : undefined}>
              <td style={{ fontWeight: 600 }}>{row.state}</td>
              <td>
                {row.isStart && (
                  <span className="badge-marker badge-start">
                    → Start
                  </span>
                )}
                {row.isAccept && (
                  <span className="badge-marker badge-accept">
                    ★ Accept
                  </span>
                )}
                {!row.isStart && !row.isAccept && '—'}
              </td>
              {data.columns.map(col => (
                <td key={col} style={{ background: getSymbolColorDim(col) }}>
                  {formatCell(row.cells[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};