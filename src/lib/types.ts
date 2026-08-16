export type AutomatonType = 'DFA' | 'NFA' | 'ENFA';

export interface Transition {
  from: string;
  to: string;
  label: string;
}

export interface Automaton {
  type: AutomatonType;
  states: string[];
  alphabet: string[];
  transitions: Transition[];
  startState: string;
  acceptStates: string[];
}

export const EPSILON = 'ε';
