# AutomataLab Engineering Rules

1. Automaton is the sole mathematical source of truth.
2. vis-network is a rendering adapter only — never authoritative.
3. Core logic (model, algorithms, simulator, equivalence checker, parser) must not import React or vis-network.
4. Conversion functions never mutate their input; they return new objects.
5. Every algorithm requires tests. Every bug fix requires a regression test.
6. Do not expand the regex grammar or add dependencies without explicit approval from me first.
7. Preserve existing working functionality unless the migration plan requires changing it.
8. Prefer small pure functions over large stateful ones.
9. Never use `any` to bypass a TypeScript error.
10. Run the full test suite before declaring any mission complete.
11. Invalid input or an invalid/incomplete automaton must produce an explicit validation error — never a silent no-op or fallback.
12. The simulator and the equivalence checker share core primitives (move, epsilonClosure, completeDFA) — the equivalence checker must not depend on the UI-facing simulator's step/trace format.
13. DFA→RE, NFA→RE, and ε-NFA→RE are the SAME algorithm: normalize the input to a GNFA first, then run one shared state-elimination function. Never implement three separate RE-generation paths.
