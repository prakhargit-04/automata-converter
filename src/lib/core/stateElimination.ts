import { type Automaton, EPSILON } from '../types.ts';
import { validateAutomaton } from '../validator.ts';

export const EMPTY_LANGUAGE_REGEX = '∅';

export interface RegexExpr {
  text: string;
  prec: number; // 1 = Union, 2 = Concat, 3 = Star, 4 = Atom
}

export interface GNFATransition {
  from: string;
  to: string;
  expr: RegexExpr;
}

export interface GNFA {
  states: string[];
  transitions: GNFATransition[];
  startState: string;
  acceptState: string;
  alphabet: string[];
}

export const PREC_UNION = 1;
export const PREC_CONCAT = 2;
export const PREC_STAR = 3;
export const PREC_ATOM = 4;

/**
 * Creates an atomic sub-regex expression.
 */
export function makeAtom(text: string): RegexExpr {
  return { text, prec: PREC_ATOM };
}

/**
 * Unions two sub-regexes.
 * Precedence is PREC_UNION. Does NOT wrap in parentheses immediately;
 * lazy-wrapping happens only in makeConcat and makeStar.
 */
export function makeUnion(a: RegexExpr, b: RegexExpr): RegexExpr {
  return {
    text: `${a.text}|${b.text}`,
    prec: PREC_UNION
  };
}

/**
 * Concatenates two sub-regexes.
 * Parenthesizes terms if their precedence is lower than PREC_CONCAT (i.e. Union).
 */
export function makeConcat(a: RegexExpr, b: RegexExpr): RegexExpr {
  // Simplification under identity: ε · R = R · ε = R.
  // This is safe because the automaton's alphabet is strictly alphanumeric,
  // meaning no composed or atomic transition text can ever be equal to the EPSILON constant.
  // Thus, this check matches only actual epsilon atoms and will never collide with composed text.
  if (a.text === EPSILON && b.text === EPSILON) {
    return a;
  }
  if (a.text === EPSILON) {
    return b;
  }
  if (b.text === EPSILON) {
    return a;
  }

  const t1 = a.prec < PREC_CONCAT ? `(${a.text})` : a.text;
  const t2 = b.prec < PREC_CONCAT ? `(${b.text})` : b.text;
  return {
    text: `${t1}${t2}`,
    prec: PREC_CONCAT
  };
}

/**
 * Stars a sub-regex.
 * Parenthesizes the term if its precedence is lower than PREC_STAR (i.e. Concat, Union).
 */
export function makeStar(a: RegexExpr): RegexExpr {
  const t = a.prec < PREC_STAR ? `(${a.text})` : a.text;
  return {
    text: `${t}*`,
    prec: PREC_STAR
  };
}

/**
 * Normalizes an ENFA, NFA, or DFA into a GNFA.
 * Grouping parallel transitions is handled via repeated makeUnion() folds, keeping prec = 1 unwrapped.
 */
export function normalizeToGNFA(automaton: Automaton): GNFA {
  validateAutomaton(automaton);

  // New start and accept states, ensuring no collisions
  let startState = 'GNFA_START';
  let acceptState = 'GNFA_ACCEPT';
  let startCounter = 0;
  while (automaton.states.includes(startState)) {
    startState = `GNFA_START_${startCounter++}`;
  }
  let acceptCounter = 0;
  while (automaton.states.includes(acceptState)) {
    acceptState = `GNFA_ACCEPT_${acceptCounter++}`;
  }

  const transitions: GNFATransition[] = [];

  // Epsilon transition from the new start state to the original start state
  transitions.push({
    from: startState,
    to: automaton.startState,
    expr: makeAtom(EPSILON)
  });

  // Epsilon transitions from all original accept states to the new accept state
  for (const acc of automaton.acceptStates) {
    transitions.push({
      from: acc,
      to: acceptState,
      expr: makeAtom(EPSILON)
    });
  }

  // Group original transitions by (from, to) pair
  const groups = new Map<string, string[]>();
  for (const t of automaton.transitions) {
    const key = `${t.from}->${t.to}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(t.label);
  }

  for (const [key, labels] of groups.entries()) {
    const [from, to] = key.split('->');
    const uniqueLabels = Array.from(new Set(labels)).sort();

    // Repeated makeUnion() folds keeping prec = 1 unwrapped
    let expr = makeAtom(uniqueLabels[0]);
    for (let i = 1; i < uniqueLabels.length; i++) {
      expr = makeUnion(expr, makeAtom(uniqueLabels[i]));
    }

    transitions.push({ from, to, expr });
  }

  return {
    states: [startState, acceptState, ...automaton.states],
    transitions,
    startState,
    acceptState,
    alphabet: [...automaton.alphabet]
  };
}

/**
 * Eliminates intermediate states one by one.
 *
 * Elimination Order:
 * States are eliminated in their original gnfa.states array order (excluding GNFA_START/GNFA_ACCEPT).
 */
export function stateElimination(gnfa: GNFA): string {
  const statesToEliminate = gnfa.states.filter(
    s => s !== gnfa.startState && s !== gnfa.acceptState
  );

  for (const q of statesToEliminate) {
    // Identify self-loop q -> q if present
    const selfLoop = gnfa.transitions.find(t => t.from === q && t.to === q);
    const S_q = selfLoop ? selfLoop.expr : undefined;

    // For every (in, out) pair: explicitly exclude in == q and out == q
    // to prevent self-loop transitions from being double-counted.
    for (const inState of gnfa.states) {
      if (inState === q || inState === gnfa.acceptState) continue;
      for (const outState of gnfa.states) {
        if (outState === q || outState === gnfa.startState) continue;

        // Path must exist: inState -> q -> outState
        const tInQ = gnfa.transitions.find(t => t.from === inState && t.to === q);
        if (!tInQ) continue;

        const tQOut = gnfa.transitions.find(t => t.from === q && t.to === outState);
        if (!tQOut) continue;

        let path: RegexExpr;
        if (S_q) {
          path = makeConcat(tInQ.expr, makeConcat(makeStar(S_q), tQOut.expr));
        } else {
          path = makeConcat(tInQ.expr, tQOut.expr);
        }

        const existingIndex = gnfa.transitions.findIndex(
          t => t.from === inState && t.to === outState
        );

        if (existingIndex !== -1) {
          const existing = gnfa.transitions[existingIndex];
          gnfa.transitions[existingIndex] = {
            from: inState,
            to: outState,
            expr: makeUnion(existing.expr, path)
          };
        } else {
          gnfa.transitions.push({
            from: inState,
            to: outState,
            expr: path
          });
        }
      }
    }

    // Remove state q and all its incoming/outgoing transitions
    gnfa.states = gnfa.states.filter(s => s !== q);
    gnfa.transitions = gnfa.transitions.filter(t => t.from !== q && t.to !== q);
  }

  // Final transition between startState and acceptState
  const finalTransition = gnfa.transitions.find(
    t => t.from === gnfa.startState && t.to === gnfa.acceptState
  );

  return finalTransition ? finalTransition.expr.text : EMPTY_LANGUAGE_REGEX;
}

/**
 * Generates a regular expression string from an automaton using GNFA state elimination.
 *
 * Precedence / Parenthesization Strategy:
 * - Always wrap any non-atomic sub-regex fragment before applying concatenation or star.
 * - This is managed systematically via structural RegexExpr precedence tracking (Union = 1, Concat = 2, Star = 3, Atom = 4).
 *
 * API Contract:
 * - Returns a Mission-2-parseable regex string in all cases except the empty language,
 *   where it returns EMPTY_LANGUAGE_REGEX ('∅') — callers must check for this sentinel
 *   before passing the result to tokenize().
 *
 * Elimination Order:
 * - States are eliminated in the order they appear in the automaton's states list (after GNFA start/accept setup).
 */
export function generateRegex(automaton: Automaton): string {
  const gnfa = normalizeToGNFA(automaton);
  return stateElimination(gnfa);
}
