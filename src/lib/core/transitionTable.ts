import { type Automaton, EPSILON } from '../types.ts';
import { ValidationError } from '../validator.ts';

export interface TransitionTableRow {
  state: string;
  isStart: boolean;
  isAccept: boolean;
  cells: Record<string, string[]>; // symbol -> target state(s)
}

export interface TransitionTableData {
  columns: string[];  // alphabet symbols, in automaton.alphabet order,
                       // PLUS an explicit EPSILON column appended last
                       // if and only if automaton.type === 'ENFA' and
                       // at least one epsilon transition exists
  rows: TransitionTableRow[]; // in automaton.states order
}

/**
 * Builds a structured transition table mapping from an Automaton.
 *
 * Preconditions:
 * - Throw ValidationError if startState is not in states.
 * - Throw ValidationError if any transition references a from or to state not in states.
 */
export function buildTransitionTable(automaton: Automaton): TransitionTableData {
  // Precondition 1: Start state validation
  if (!automaton.states.includes(automaton.startState)) {
    throw new ValidationError(
      `Start state "${automaton.startState}" is not present in the states list: [${automaton.states.join(', ')}].`
    );
  }

  // Precondition 2: Transition states check
  for (const t of automaton.transitions) {
    if (!automaton.states.includes(t.from)) {
      throw new ValidationError(
        `Transition contains a non-existent source state "${t.from}".`
      );
    }
    if (!automaton.states.includes(t.to)) {
      throw new ValidationError(
        `Transition contains a non-existent target state "${t.to}".`
      );
    }
  }

  // Build columns
  const columns = [...automaton.alphabet];
  
  // Append EPSILON if type is ENFA and at least one epsilon transition is present
  if (automaton.type === 'ENFA') {
    const hasEpsilon = automaton.transitions.some(t => t.label === EPSILON);
    if (hasEpsilon) {
      columns.push(EPSILON);
    }
  }

  // Build rows
  const rows: TransitionTableRow[] = automaton.states.map(state => {
    const cells: Record<string, string[]> = {};

    for (const col of columns) {
      // Find all transitions matching state and symbol in transitions order
      const targets = automaton.transitions
        .filter(t => t.from === state && t.label === col)
        .map(t => t.to);

      cells[col] = targets;
    }

    const isStart = state === automaton.startState;
    const isAccept = automaton.acceptStates.includes(state);

    return {
      state,
      isStart,
      isAccept,
      cells
    };
  });

  return {
    columns,
    rows
  };
}
