import { type Automaton, EPSILON } from './types.ts';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateAutomaton(automaton: Automaton): void {
  if (!automaton) {
    throw new ValidationError('Automaton is null or undefined.');
  }

  const { type, states, alphabet, transitions, startState, acceptStates } = automaton;

  if (type !== 'DFA' && type !== 'NFA' && type !== 'ENFA') {
    throw new ValidationError(`Invalid automaton type: "${type}". Must be "DFA", "NFA", or "ENFA".`);
  }

  if (!states || !Array.isArray(states)) {
    throw new ValidationError('Automaton must have a valid states array.');
  }

  // 1. All states in states must be unique
  const stateSet = new Set(states);
  if (stateSet.size !== states.length) {
    throw new ValidationError('Automaton states must be unique.');
  }

  // 2. startState is defined and belongs to states
  if (startState === undefined || startState === null || startState === '') {
    throw new ValidationError('Automaton startState must be defined.');
  }
  if (!stateSet.has(startState)) {
    throw new ValidationError(`Start state "${startState}" is not in the states list.`);
  }

  // 3. All acceptStates belong to states
  if (!acceptStates || !Array.isArray(acceptStates)) {
    throw new ValidationError('Automaton acceptStates must be a valid array.');
  }
  for (const acceptState of acceptStates) {
    if (!stateSet.has(acceptState)) {
      throw new ValidationError(`Accept state "${acceptState}" is not in the states list.`);
    }
  }

  // Check alphabet
  if (!alphabet || !Array.isArray(alphabet)) {
    throw new ValidationError('Automaton alphabet must be a valid array.');
  }
  const alphabetSet = new Set(alphabet);
  if (alphabetSet.has(EPSILON)) {
    throw new ValidationError(`Alphabet cannot contain the epsilon symbol "${EPSILON}".`);
  }

  // 4. Validate transitions
  if (!transitions || !Array.isArray(transitions)) {
    throw new ValidationError('Automaton transitions must be a valid array.');
  }

  for (const t of transitions) {
    if (!stateSet.has(t.from)) {
      throw new ValidationError(`Transition source state "${t.from}" is not in the states list.`);
    }
    if (!stateSet.has(t.to)) {
      throw new ValidationError(`Transition target state "${t.to}" is not in the states list.`);
    }
    if (t.label !== EPSILON && !alphabetSet.has(t.label)) {
      throw new ValidationError(`Transition label "${t.label}" is not in the alphabet.`);
    }
    if (t.label === EPSILON && type !== 'ENFA') {
      throw new ValidationError(`Epsilon transitions are not allowed in ${type} automata.`);
    }
  }

  // 5. DFA checks
  if (type === 'DFA') {
    // Check determinism: for each state and each character, there is at most one transition
    const seen = new Set<string>();
    for (const t of transitions) {
      const key = `${t.from}:${t.label}`;
      if (seen.has(key)) {
        throw new ValidationError(`DFA is non-deterministic: State "${t.from}" has multiple transitions for label "${t.label}".`);
      }
      seen.add(key);
    }
  }
}
