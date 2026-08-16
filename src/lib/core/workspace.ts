import { type Automaton } from '../types.ts';
import { validateAutomaton, ValidationError } from '../validator.ts';
import { tokenize } from '../regex/lexer.ts';
import { Parser } from '../regex/parser.ts';
import { compileASTToENFA } from './thompson.ts';
import { eliminateEpsilon } from './epsilonElimination.ts';
import { compileToDFA } from './subsetConstruction.ts';
import { minimizeDFA } from './minimization.ts';
import { generateRegex, EMPTY_LANGUAGE_REGEX } from './stateElimination.ts';
import { areEquivalent, type EquivalenceResult } from './equivalence.ts';

export interface WorkspaceItem {
  id: string;              // stable, e.g. crypto.randomUUID()
  label: string;            // e.g. "DFA (from subset construction)"
  parentId: string | null;  // the item this was derived from, null for
                             // a freshly compiled/pasted regex or a
                             // canvas save with no prior lineage
  createdBy: string;        // which action produced this, e.g.
                             // 'compileRegex' | 'eliminateEpsilon' |
                             // 'subsetConstruction' | 'minimize' |
                             // 'generateRegex' | 'canvasSave'
  payload:
    | { kind: 'automaton'; automaton: Automaton }
    | { kind: 'regex'; regexString: string };
}

/**
 * Generates a stable unique identifier.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + '-' + Math.random().toString(36).substring(2, 15);
}

/**
 * Normalizes any regex or automaton payload to a DFA.
 */
export function normalizeToDFA(payload: WorkspaceItem['payload']): Automaton {
  if (payload.kind === 'regex') {
    if (payload.regexString === EMPTY_LANGUAGE_REGEX) {
      return {
        type: 'DFA',
        states: ['q0'],
        alphabet: [],
        transitions: [],
        startState: 'q0',
        acceptStates: []
      };
    }
    const tokens = tokenize(payload.regexString);
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const enfa = compileASTToENFA(ast);
    const nfa = eliminateEpsilon(enfa);
    return compileToDFA(nfa);
  } else {
    const aut = payload.automaton;
    validateAutomaton(aut);
    if (aut.type === 'DFA') {
      return {
        type: 'DFA',
        states: [...aut.states],
        alphabet: [...aut.alphabet],
        transitions: aut.transitions.map(t => ({ ...t })),
        startState: aut.startState,
        acceptStates: [...aut.acceptStates]
      };
    }
    // NFA or ENFA
    const nfa = aut.type === 'ENFA' ? eliminateEpsilon(aut) : aut;
    return compileToDFA(nfa);
  }
}

/**
 * Compares two workspace items for language equivalence.
 */
export function compareWorkspaceItems(
  itemA: WorkspaceItem,
  itemB: WorkspaceItem
): EquivalenceResult {
  const dfaA = normalizeToDFA(itemA.payload);
  const dfaB = normalizeToDFA(itemB.payload);
  return areEquivalent(dfaA, dfaB);
}

/**
 * Finds a workspace item by ID, throwing validation error if not found.
 */
function findItem(items: WorkspaceItem[], itemId: string): WorkspaceItem {
  const found = items.find(item => item.id === itemId);
  if (!found) {
    throw new ValidationError(`Workspace item with ID "${itemId}" not found.`);
  }
  return found;
}

/**
 * Adds a freshly typed regex to the workspace.
 */
export function addRegexToWorkspace(
  items: WorkspaceItem[],
  regexString: string
): WorkspaceItem[] {
  if (!regexString || regexString.trim() === '') {
    throw new ValidationError('Regex string cannot be empty.');
  }

  const newItem: WorkspaceItem = {
    id: generateUUID(),
    label: `Regex: "${regexString}"`,
    parentId: null,
    createdBy: 'typedFresh',
    payload: { kind: 'regex', regexString }
  };

  return [...items, newItem];
}

/**
 * Compiles a regex item to an ENFA.
 */
export function compileRegexInWorkspace(
  items: WorkspaceItem[],
  itemId: string
): WorkspaceItem[] {
  const item = findItem(items, itemId);

  if (item.payload.kind !== 'regex') {
    throw new ValidationError(
      `Compile Regex action requires a regex item payload, but got kind "${item.payload.kind}".`
    );
  }

  const regexString = item.payload.regexString;

  if (regexString === EMPTY_LANGUAGE_REGEX) {
    throw new ValidationError('cannot compile the empty-language sentinel back into an automaton');
  }

  const tokens = tokenize(regexString);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const enfa = compileASTToENFA(ast);

  const newItem: WorkspaceItem = {
    id: generateUUID(),
    label: 'ENFA (from Thompson construction)',
    parentId: itemId,
    createdBy: 'compileRegex',
    payload: { kind: 'automaton', automaton: enfa }
  };

  return [...items, newItem];
}

/**
 * Eliminates epsilon transitions from an ENFA.
 */
export function eliminateEpsilonInWorkspace(
  items: WorkspaceItem[],
  itemId: string
): WorkspaceItem[] {
  const item = findItem(items, itemId);

  if (item.payload.kind !== 'automaton') {
    throw new ValidationError(
      `Epsilon Elimination action requires an automaton payload, but got kind "${item.payload.kind}".`
    );
  }

  const automaton = item.payload.automaton;

  if (automaton.type !== 'ENFA') {
    throw new ValidationError(
      `Epsilon Elimination action requires type "ENFA", but got type "${automaton.type}".`
    );
  }

  // safe to pass automaton directly — eliminateEpsilon does not mutate its input (verified 2026-08-16)
  const nfa = eliminateEpsilon(automaton);

  const newItem: WorkspaceItem = {
    id: generateUUID(),
    label: 'NFA (from epsilon elimination)',
    parentId: itemId,
    createdBy: 'eliminateEpsilon',
    payload: { kind: 'automaton', automaton: nfa }
  };

  return [...items, newItem];
}

/**
 * Runs subset construction on an NFA.
 */
export function subsetConstructionInWorkspace(
  items: WorkspaceItem[],
  itemId: string
): WorkspaceItem[] {
  const item = findItem(items, itemId);

  if (item.payload.kind !== 'automaton') {
    throw new ValidationError(
      `Subset Construction action requires an automaton payload, but got kind "${item.payload.kind}".`
    );
  }

  const automaton = item.payload.automaton;

  if (automaton.type !== 'NFA') {
    throw new ValidationError(
      `Subset Construction action requires type "NFA", but got type "${automaton.type}".`
    );
  }

  // safe to pass automaton directly — compileToDFA does not mutate its input (verified 2026-08-16)
  const dfa = compileToDFA(automaton);

  const newItem: WorkspaceItem = {
    id: generateUUID(),
    label: 'DFA (from subset construction)',
    parentId: itemId,
    createdBy: 'subsetConstruction',
    payload: { kind: 'automaton', automaton: dfa }
  };

  return [...items, newItem];
}

/**
 * Minimizes a DFA.
 */
export function minimizeInWorkspace(
  items: WorkspaceItem[],
  itemId: string
): WorkspaceItem[] {
  const item = findItem(items, itemId);

  if (item.payload.kind !== 'automaton') {
    throw new ValidationError(
      `Minimization action requires an automaton payload, but got kind "${item.payload.kind}".`
    );
  }

  const automaton = item.payload.automaton;

  if (automaton.type !== 'DFA') {
    throw new ValidationError(
      `Minimization action requires type "DFA", but got type "${automaton.type}".`
    );
  }

  // safe to pass automaton directly — minimizeDFA does not mutate its input (verified 2026-08-16)
  const minimized = minimizeDFA(automaton);

  const newItem: WorkspaceItem = {
    id: generateUUID(),
    label: 'DFA (minimized)',
    parentId: itemId,
    createdBy: 'minimize',
    payload: { kind: 'automaton', automaton: minimized }
  };

  return [...items, newItem];
}

/**
 * Generates a regex from an automaton (DFA/NFA/ENFA).
 */
export function generateRegexInWorkspace(
  items: WorkspaceItem[],
  itemId: string
): WorkspaceItem[] {
  const item = findItem(items, itemId);

  if (item.payload.kind !== 'automaton') {
    throw new ValidationError(
      `Generate Regex action requires an automaton payload, but got kind "${item.payload.kind}".`
    );
  }

  const automaton = item.payload.automaton;
  const regexString = generateRegex(automaton);

  const newItem: WorkspaceItem = {
    id: generateUUID(),
    label: 'Regex (from state elimination)',
    parentId: itemId,
    createdBy: 'generateRegex',
    payload: { kind: 'regex', regexString }
  };

  return [...items, newItem];
}
