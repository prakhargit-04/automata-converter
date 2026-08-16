import React from 'react';
import { type Automaton } from '../lib/types.ts';
import { buildTransitionTable, type TransitionTableData } from '../lib/core/transitionTable.ts';

interface TransitionTableProps {
  automaton: Automaton;
}

export const TransitionTable: React.FC<TransitionTableProps> = ({ automaton }) => {
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
      <div style={{ padding: '1rem', color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', fontSize: '0.875rem' }}>
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
        }
        .transition-table th, .transition-table td {
          border: 1px solid var(--panel-border);
          padding: 0.75rem;
          text-align: center;
          font-family: 'Inter', sans-serif;
          font-size: 0.9rem;
        }
        .transition-table th {
          background-color: rgba(15, 23, 42, 0.6);
          color: var(--primary);
          font-weight: 600;
        }
        .transition-table tr:hover {
          background-color: rgba(59, 130, 246, 0.05);
        }
        .badge-marker {
          font-weight: bold;
          font-size: 0.75rem;
          padding: 0.2rem 0.5rem;
          border-radius: 4px;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
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
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map(row => (
            <tr key={row.state}>
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
                <td key={col} style={{ fontFamily: 'monospace' }}>
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
