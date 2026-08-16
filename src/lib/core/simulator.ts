import { type Automaton } from '../types.ts';
import { validateAutomaton, ValidationError } from '../validator.ts';
import { move, epsilonClosure } from './primitives.ts';

export interface StepInfo {
  symbol: string;
  activeStates: string[];
  description: string;
}

export interface SimulationResult {
  accepted: boolean;
  path: string[][];
  steps: StepInfo[];
}

/**
 * Simulates a DFA on an input string.
 * Throws ValidationError if the automaton is invalid or contains symbols outside the alphabet.
 */
export function simulateDFA(dfa: Automaton, input: string): SimulationResult {
  validateAutomaton(dfa);
  if (dfa.type !== 'DFA') {
    throw new ValidationError(`Expected DFA, but got ${dfa.type}`);
  }

  // Validate all input characters are inside the DFA alphabet
  const alphabetSet = new Set(dfa.alphabet);
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (!alphabetSet.has(char)) {
      throw new ValidationError(`Input symbol "${char}" at index ${i} is not in the DFA alphabet.`);
    }
  }

  const path: string[][] = [[dfa.startState]];
  const steps: StepInfo[] = [];
  let currentState = dfa.startState;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const transition = dfa.transitions.find(t => t.from === currentState && t.label === char);

    if (!transition) {
      // Dies mid-walk: stop recording path and steps immediately
      break;
    }

    currentState = transition.to;
    path.push([currentState]);
    steps.push({
      symbol: char,
      activeStates: [currentState],
      description: `Step ${i + 1}: On input '${char}', transition from "${transition.from}" to "${transition.to}".`
    });
  }

  const accepted = path.length === input.length + 1 && dfa.acceptStates.includes(currentState);
  return { accepted, path, steps };
}

/**
 * Simulates an NFA on an input string.
 * Throws ValidationError if the automaton is invalid or contains symbols outside the alphabet.
 */
export function simulateNFA(nfa: Automaton, input: string): SimulationResult {
  validateAutomaton(nfa);
  if (nfa.type !== 'NFA') {
    throw new ValidationError(`Expected NFA, but got ${nfa.type}`);
  }

  // Validate all input characters are inside the NFA alphabet
  const alphabetSet = new Set(nfa.alphabet);
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (!alphabetSet.has(char)) {
      throw new ValidationError(`Input symbol "${char}" at index ${i} is not in the NFA alphabet.`);
    }
  }

  let activeStates = [nfa.startState];
  const path: string[][] = [activeStates];
  const steps: StepInfo[] = [];

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const nextStates = move(nfa, activeStates, char);

    if (nextStates.length === 0) {
      // Dies mid-walk
      break;
    }

    activeStates = nextStates;
    path.push(activeStates);
    steps.push({
      symbol: char,
      activeStates: activeStates,
      description: `Step ${i + 1}: On input '${char}', move to active states {${activeStates.join(', ')}}.`
    });
  }

  const accepted = path.length === input.length + 1 && activeStates.some(s => nfa.acceptStates.includes(s));
  return { accepted, path, steps };
}

/**
 * Simulates an ENFA on an input string.
 * Throws ValidationError if the automaton is invalid or contains symbols outside the alphabet.
 */
export function simulateENFA(enfa: Automaton, input: string): SimulationResult {
  validateAutomaton(enfa);
  if (enfa.type !== 'ENFA') {
    throw new ValidationError(`Expected ENFA, but got ${enfa.type}`);
  }

  // Validate all input characters are inside the ENFA alphabet
  const alphabetSet = new Set(enfa.alphabet);
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (!alphabetSet.has(char)) {
      throw new ValidationError(`Input symbol "${char}" at index ${i} is not in the ENFA alphabet.`);
    }
  }

  let activeStates = epsilonClosure(enfa, [enfa.startState]);
  const path: string[][] = [activeStates];
  const steps: StepInfo[] = [];

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const moved = move(enfa, activeStates, char);
    const nextStates = epsilonClosure(enfa, moved);

    if (nextStates.length === 0) {
      // Dies mid-walk
      break;
    }

    activeStates = nextStates;
    path.push(activeStates);
    steps.push({
      symbol: char,
      activeStates: activeStates,
      description: `Step ${i + 1}: On input '${char}', move to {${moved.join(', ')}}, epsilon closure -> {${activeStates.join(', ')}}.`
    });
  }

  const accepted = path.length === input.length + 1 && activeStates.some(s => enfa.acceptStates.includes(s));
  return { accepted, path, steps };
}