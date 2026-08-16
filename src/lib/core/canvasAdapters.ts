import { type Automaton, EPSILON } from '../types.ts';
import { validateAutomaton, ValidationError } from '../validator.ts';

/**
 * Validates that a state name is non-empty and alphanumeric.
 */
function validateStateName(name: string): void {
  if (!name || name.trim() === '') {
    throw new ValidationError('State name cannot be empty.');
  }
  if (!/^[a-zA-Z0-9]+$/.test(name)) {
    throw new ValidationError(`Invalid state name "${name}". State names must be alphanumeric.`);
  }
}

/**
 * Validates that a transition label is a single alphanumeric character or EPSILON.
 */
function validateTransitionLabel(label: string): void {
  if (label !== EPSILON && !/^[a-zA-Z0-9]$/.test(label)) {
    throw new ValidationError(
      `Invalid transition symbol "${label}". Symbol must be a single alphanumeric character or EPSILON ("${EPSILON}").`
    );
  }
}

/**
 * Adds a state to the automaton.
 */
export function applyAddState(automaton: Automaton, stateName: string): Automaton {
  validateStateName(stateName);
  
  if (automaton.states.includes(stateName)) {
    throw new ValidationError(`State with name "${stateName}" already exists.`);
  }

  const nextAutomaton: Automaton = {
    ...automaton,
    states: [...automaton.states, stateName].sort()
  };

  validateAutomaton(nextAutomaton);
  return nextAutomaton;
}

/**
 * Deletes a state from the automaton.
 * Cascade deletes any incoming/outgoing transitions referencing this state.
 */
export function applyDeleteState(automaton: Automaton, stateName: string): Automaton {
  if (!automaton.states.includes(stateName)) {
    throw new ValidationError(`State "${stateName}" does not exist in the automaton.`);
  }

  const nextStates = automaton.states.filter(s => s !== stateName);
  const nextAcceptStates = automaton.acceptStates.filter(s => s !== stateName);
  
  // Cascade delete transitions where this state appears as from or to
  const nextTransitions = automaton.transitions.filter(
    t => t.from !== stateName && t.to !== stateName
  );

  const nextAutomaton: Automaton = {
    ...automaton,
    states: nextStates,
    acceptStates: nextAcceptStates,
    transitions: nextTransitions
  };

  validateAutomaton(nextAutomaton);
  return nextAutomaton;
}

/**
 * Renames an existing state.
 */
export function applyRenameState(automaton: Automaton, oldName: string, newName: string): Automaton {
  validateStateName(newName);

  if (!automaton.states.includes(oldName)) {
    throw new ValidationError(`State "${oldName}" does not exist.`);
  }

  if (oldName === newName) {
    return automaton; // No-op
  }

  if (automaton.states.includes(newName)) {
    throw new ValidationError(`Rename collision: State "${newName}" already exists.`);
  }

  const nextStates = automaton.states.map(s => (s === oldName ? newName : s)).sort();
  const nextStartState = automaton.startState === oldName ? newName : automaton.startState;
  const nextAcceptStates = automaton.acceptStates.map(s => (s === oldName ? newName : s)).sort();
  const nextTransitions = automaton.transitions.map(t => ({
    from: t.from === oldName ? newName : t.from,
    to: t.to === oldName ? newName : t.to,
    label: t.label
  }));

  const nextAutomaton: Automaton = {
    ...automaton,
    states: nextStates,
    startState: nextStartState,
    acceptStates: nextAcceptStates,
    transitions: nextTransitions
  };

  validateAutomaton(nextAutomaton);
  return nextAutomaton;
}

/**
 * Adds a transition to the automaton.
 *
 * Auto-Demotion & Alphabet Auto-Addition Rules:
 * 1. Type demotion is a one-way ratchet: type only ever demotes automatically (DFA -> NFA -> ENFA)
 *    on a qualifying edit; it never auto-promotes back when that edit is later undone.
 * 2. If the label is EPSILON, the automaton is automatically demoted to 'ENFA' (if it was 'DFA' or 'NFA').
 * 3. If the type is 'DFA' and there already exists a transition from the same 'from' state on the
 *    same label, its type is automatically demoted to 'NFA'.
 * 4. Alphabet symbols are automatically added to the alphabet if not already present.
 */
export function applyAddTransition(
  automaton: Automaton,
  from: string,
  to: string,
  label: string
): Automaton {
  if (!automaton.states.includes(from)) {
    throw new ValidationError(`Source state "${from}" does not exist.`);
  }
  if (!automaton.states.includes(to)) {
    throw new ValidationError(`Target state "${to}" does not exist.`);
  }
  validateTransitionLabel(label);

  // Check collision: no duplicate transitions
  const duplicate = automaton.transitions.some(
    t => t.from === from && t.to === to && t.label === label
  );
  if (duplicate) {
    throw new ValidationError(`Transition from "${from}" to "${to}" on "${label}" already exists.`);
  }

  // Determine next type (demotions only, no promotions)
  let nextType = automaton.type;
  if (label === EPSILON) {
    nextType = 'ENFA';
  } else if (automaton.type === 'DFA') {
    const hasExistingTransitionOnLabel = automaton.transitions.some(
      t => t.from === from && t.label === label
    );
    if (hasExistingTransitionOnLabel) {
      nextType = 'NFA';
    }
  }

  // Auto-add new alphabet symbols (excluding EPSILON)
  const nextAlphabet = [...automaton.alphabet];
  if (label !== EPSILON && !nextAlphabet.includes(label)) {
    nextAlphabet.push(label);
    nextAlphabet.sort();
  }

  const nextTransitions = [
    ...automaton.transitions,
    { from, to, label }
  ].sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.label !== b.label) return a.label.localeCompare(b.label);
    return a.to.localeCompare(b.to);
  });

  const nextAutomaton: Automaton = {
    ...automaton,
    type: nextType,
    alphabet: nextAlphabet,
    transitions: nextTransitions
  };

  validateAutomaton(nextAutomaton);
  return nextAutomaton;
}

/**
 * Deletes a transition.
 *
 * Undoing & Alphabet Rules:
 * 1. Undoing a transition that caused NFA/ENFA demotion does NOT promote the automaton back.
 * 2. Alphabet symbols are never automatically removed when the last transition using them is deleted
 *    — a symbol remaining in the alphabet with zero transitions is valid and expected.
 */
export function applyDeleteTransition(
  automaton: Automaton,
  from: string,
  to: string,
  label: string
): Automaton {
  const nextTransitions = automaton.transitions.filter(
    t => !(t.from === from && t.to === to && t.label === label)
  );

  if (nextTransitions.length === automaton.transitions.length) {
    throw new ValidationError(`Transition from "${from}" to "${to}" on "${label}" does not exist.`);
  }

  const nextAutomaton: Automaton = {
    ...automaton,
    transitions: nextTransitions
  };

  validateAutomaton(nextAutomaton);
  return nextAutomaton;
}

/**
 * Sets the start state.
 */
export function applySetStartState(automaton: Automaton, stateName: string): Automaton {
  if (!automaton.states.includes(stateName)) {
    throw new ValidationError(`State "${stateName}" does not exist.`);
  }

  const nextAutomaton: Automaton = {
    ...automaton,
    startState: stateName
  };

  validateAutomaton(nextAutomaton);
  return nextAutomaton;
}

/**
 * Toggles a state's accept status.
 */
export function applyToggleAcceptState(automaton: Automaton, stateName: string): Automaton {
  if (!automaton.states.includes(stateName)) {
    throw new ValidationError(`State "${stateName}" does not exist.`);
  }

  let nextAcceptStates = [...automaton.acceptStates];
  if (nextAcceptStates.includes(stateName)) {
    nextAcceptStates = nextAcceptStates.filter(s => s !== stateName);
  } else {
    nextAcceptStates.push(stateName);
    nextAcceptStates.sort();
  }

  const nextAutomaton: Automaton = {
    ...automaton,
    acceptStates: nextAcceptStates
  };

  validateAutomaton(nextAutomaton);
  return nextAutomaton;
}
