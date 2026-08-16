<div align="center">

# 🔁 Automata Lab

### Regex ⇄ ε-NFA ⇄ NFA ⇄ DFA ⇄ Minimal DFA — full bidirectional pipeline, one workspace.

[![Tests](https://img.shields.io/badge/tests-159%2F159%20passing-brightgreen?style=for-the-badge&logo=vitest)](#-testing)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](#-tech-stack)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](#-tech-stack)
[![Vite](https://img.shields.io/badge/Vite-powered-646CFF?style=for-the-badge&logo=vite&logoColor=white)](#-tech-stack)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](#-license)

**A node-based, non-destructive playground for the theory of computation —**
**build it by hand, generate it from a regex, or both. Compare everything. Trust nothing you can't verify.**

[Features](#-features) • [Quick Start](#-quick-start) • [Pipeline](#-the-pipeline) • [Architecture](#-architecture) • [Testing](#-testing) • [Roadmap](#-roadmap)

</div>

---

## ✨ Why this exists

Most regex/automata converters are one-way, one-shot, and impossible to verify by eye. **Automata Lab** is different on three counts:

- **🔄 Fully bidirectional.** Every classical conversion in the theory-of-computation toolkit is implemented as a pure, independently-tested function — not a black box.
- **🧬 Non-destructive workspace.** Every conversion creates a *new* item with full lineage back to its parent. Nothing is ever overwritten. Compare any two items — including a regex and the automaton it produced five steps later — for language equivalence, with a counterexample if they differ.
- **🔬 Provably correct, not just "looks right."** Every algorithm was built, then hand-traced against textbook examples, then round-tripped through an equivalence checker before being accepted. 159 automated tests hold that line permanently.

---

## 🚀 Features

<table>
<tr>
<td width="50%" valign="top">

### 🧮 Core Engine
- Custom regex lexer & parser (`|`, `*`, `(`, `)`, `ε`, alphanumerics)
- Regex → ε-NFA via **Thompson's Construction**
- ε-NFA → NFA via **Epsilon Elimination**
- NFA → DFA via **Subset Construction**
- DFA → Minimal DFA via **Partition Refinement**
- DFA/NFA/ENFA → Regex via **GNFA State Elimination**
- One-click **Regex → DFA** shortcut
- **DFA → NFA** relabeling for manual editing

</td>
<td width="50%" valign="top">

### 🧠 Verification & Simulation
- String simulator for DFA, NFA, and ENFA
- Product-automaton **equivalence checker**
- `true`/`false` result **+ counterexample string**
- Explicit `∅` empty-language handling — no silent lexer crashes

### 🗂️ Workspace
- Non-destructive pipeline — sources are never mutated
- Full **lineage tracking** across every transformation
- Side-by-side item comparison
- Strict validation — wrong item type throws a clear error, never silent corruption

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🎨 Canvas Editor
- Build automata by hand — add/rename/delete states & transitions
- Set start/accept states visually
- Save directly into the workspace
- Rollback-safe: a failed action never leaves a corrupted canvas

</td>
<td width="50%" valign="top">

### 📊 Dual Visualization
- **Graph View** — interactive node diagram (`vis-network`)
- **Table View** — full transition table, missing cells shown honestly
- Toggle either view without losing state
- Multi-target NFA/ENFA cells rendered as `{q1, q2}`, not truncated

</td>
</tr>
</table>

---

## 🔗 The Pipeline

```
                    ┌─────────────┐
              ┌────▶│   Regex     │◀────┐
              │     └──────┬──────┘     │
              │            │ Thompson's │
      State   │            ▼            │  Regex→DFA
   Elimination│     ┌─────────────┐     │  (shortcut)
              │     │    ε-NFA    │     │
              │     └──────┬──────┘     │
              │            │ Epsilon    │
              │            │ Elimination│
              │            ▼            │
              │     ┌─────────────┐     │
              │     │     NFA     │─────┼──▶ relabel
              │     └──────┬──────┘     │
              │            │ Subset     │
              │            │Construction│
              │            ▼            │
              │     ┌─────────────┐     │
              └─────│     DFA     │─────┘
                    └──────┬──────┘
                           │ Minimize
                           ▼
                    ┌─────────────┐
                    │  Minimal    │
                    │     DFA     │
                    └─────────────┘
```

Every arrow above is a real, tested, independently-callable function — not a UI illusion.

---

## 🏁 Quick Start

```bash
# Clone the repo
git clone https://github.com/prakhargit-04/automata-converter.git
cd automata-converter

# Install dependencies
npm install

# Fire it up
npm run dev
```

Open **`http://localhost:5173`** and you're in.

### Try it in 30 seconds

1. Go to **Workspace Repository** → type `(a|b)*abb` → **Add**
2. Click **Compile Regex** → **Eliminate Epsilon** → **Subset Construction** → **Minimize** → **Generate Regex**
3. Select your original regex as **Item A** and the freshly generated one as **Item B**
4. Hit **Verify Equivalence** → `true` ✅ — the language survived five transformations intact.

---

## 🏗️ Architecture

```
src/
├── lib/
│   ├── types.ts                  # Shared Automaton/Transition types
│   ├── validator.ts               # Structural validation (single source of truth)
│   ├── regex/
│   │   ├── lexer.ts                # Tokenizer
│   │   └── parser.ts               # Recursive-descent parser → AST
│   └── core/
│       ├── thompson.ts             # Regex AST → ε-NFA
│       ├── epsilonElimination.ts   # ε-NFA → NFA
│       ├── subsetConstruction.ts   # NFA → DFA
│       ├── minimization.ts         # DFA → Minimal DFA
│       ├── stateElimination.ts     # Automaton → Regex (GNFA)
│       ├── primitives.ts           # move, epsilonClosure, completeDFA
│       ├── simulator.ts            # simulateDFA / simulateNFA / simulateENFA
│       ├── equivalence.ts          # Product-automaton equivalence
│       ├── transitionTable.ts      # Pure table-building for Table View
│       ├── canvasAdapters.ts       # Canvas Editor ↔ Automaton bridge
│       └── workspace.ts            # Non-destructive workspace engine
├── components/
│   ├── GraphView.tsx
│   └── TransitionTable.tsx
└── tests/                          # One suite per module — 159 tests total
```

**Design principles enforced throughout:**
- Every core algorithm is a **pure function** — verified, not assumed.
- Every workspace adapter has an **explicit validation contract** — throws, never silently fails.
- Every mutation-safety claim has a **regression test that would fail if it were false**.

---

## 🧪 Testing

```bash
npm run build   # tsc -b && vite build — zero errors
npm run lint     # zero warnings
npm test          # 159/159 passing
```

| Suite | What it proves |
|---|---|
| `stateElimination.test.ts` | Self-loop double-counting, parenthesization, empty-language sentinel |
| `workspace.test.ts` | Original items are **never** mutated by downstream conversions |
| `equivalence.test.ts` | Regex round-trips preserve language across the full pipeline |
| `transitionTable.test.ts` | Incomplete DFAs render honestly, no fabricated transitions |
| `epsilonElimination.test.ts` | Closure-to-accept-state edge cases (e.g. `ε` regex) |

Every test asserts against **hand-traced textbook examples** — not just "it didn't throw."

---

## 🛠️ Tech Stack

<div align="center">

![React](https://img.shields.io/badge/React_19-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![vis-network](https://img.shields.io/badge/vis--network-graph_rendering-orange?style=flat-square)
![Node Test Runner](https://img.shields.io/badge/node--test-native-339933?style=flat-square&logo=node.js&logoColor=white)

</div>

---

## 🗺️ Roadmap

- [x] Full bidirectional conversion pipeline (Missions 1–8)
- [x] Product-automaton equivalence checker (Mission 9)
- [x] Editable Canvas with rollback-safe actions (Mission 10)
- [x] Non-destructive Workspace with lineage (Mission 11)
- [x] Transition Table view (Mission 12)
- [x] One-click Regex→DFA shortcut & DFA→NFA relabel (Mission 13)
- [ ] Delete workspace items (with lineage-aware cascade)
- [ ] Live deployment
- [ ] Exam / challenge mode with hidden-reference verification
- [ ] Undo/redo, export (PNG/SVG/JSON)

---

## 📄 License

MIT — do whatever you want with it, just keep the license notice.

---

<div align="center">

**Built algorithm by algorithm, verified test by test.**

⭐ Star this repo if it helped you understand automata theory a little better.

</div>
