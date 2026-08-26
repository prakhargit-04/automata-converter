import { useState, useMemo, useEffect } from 'react';
import { Settings, Play, Pause, Plus, Trash2, ShieldCheck, UserCheck, Info, Check, GitCommit, LayoutGrid, FileText, Shuffle, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { type Automaton, type Transition, EPSILON } from './lib/types.ts';
import { GraphView } from './components/GraphView';
import { TransitionTable } from './components/TransitionTable';
import { getSymbolColor } from './lib/alphabetColors.ts';
import { tokenize } from './lib/regex/lexer.ts';
import { Parser } from './lib/regex/parser.ts';
import { compileASTToENFA } from './lib/core/thompson.ts';
import { eliminateEpsilon } from './lib/core/epsilonElimination.ts';
import { compileToDFA } from './lib/core/subsetConstruction.ts';
import { minimizeDFA } from './lib/core/minimization.ts';
import { generateRegex } from './lib/core/stateElimination.ts';
import { relabelDFAToNFA } from './lib/core/relabel.ts';
import { areEquivalent } from './lib/core/equivalence.ts';
import { validateAutomaton } from './lib/validator.ts';
import {
  applyAddState,
  applyDeleteState,
  applyRenameState,
  applyAddTransition,
  applyDeleteTransition,
  applySetStartState,
  applyToggleAcceptState
} from './lib/core/canvasAdapters.ts';
import { simulateNFA, simulateENFA } from './lib/core/simulator.ts';
import {
  type WorkspaceItem,
  generateUUID,
  addRegexToWorkspace,
  compileRegexInWorkspace,
  eliminateEpsilonInWorkspace,
  subsetConstructionInWorkspace,
  minimizeInWorkspace,
  generateRegexInWorkspace,
  compareWorkspaceItems
} from './lib/core/workspace.ts';
import './index.css';

type Tab = 'CONVERTER' | 'EDITOR' | 'WORKSPACE';
// Expanded to cover the full pipeline the README's diagram already promises:
// Regex -> ε-NFA -> NFA -> DFA -> Minimal DFA -> Regex (state elimination).
// RE_TO_DFA is the "one-click shortcut" (view the DFA without needing to click
// through RE_TO_ENFA/RE_TO_NFA first — the useMemo already computes everything
// in one pass, this mode just gives it a dedicated, honestly-labeled view).
type Mode = 'RE_TO_ENFA' | 'RE_TO_NFA' | 'RE_TO_DFA' | 'RE_TO_MINDFA' | 'DFA_TO_RE';

// One stage in the Converter's scrubbable timeline. Each stage is a
// *real*, already-computed pipeline output (not an interpolated/faked
// in-between) — scrubbing swaps in the actual ε-NFA, NFA, DFA, etc.
interface ConverterStage {
  label: string;
  automaton?: Automaton;
  regex?: string;
}

// A DFA-only step-through trace: trace[0] is the start state before any
// input is consumed; trace[i] for i>=1 is the state reached after consuming
// trace[i].symbol. Kept local to App.tsx (rather than in lib/core/simulator)
// since it's purely a UI concern — the accept/reject logic is unchanged,
// this just keeps every intermediate state instead of only the final one.
interface SimStep {
  state: string;
  symbol?: string;
}

function computeDfaTrace(automaton: Automaton, input: string): { trace: SimStep[]; accepted: boolean; error: string | null } {
  const trace: SimStep[] = [{ state: automaton.startState }];
  let current = automaton.startState;
  for (const ch of input) {
    const t = automaton.transitions.find(tr => tr.from === current && tr.label === ch);
    if (!t) {
      return { trace, accepted: false, error: `No transition from ${current} on '${ch}'` };
    }
    current = t.to;
    trace.push({ state: current, symbol: ch });
  }
  return { trace, accepted: automaton.acceptStates.includes(current), error: null };
}

function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState<Tab>('CONVERTER');

  // View Toggle States
  const [editorViewMode, setEditorViewMode] = useState<'graph' | 'table'>('graph');
  const [workspaceViewMode, setWorkspaceViewMode] = useState<'graph' | 'table'>('graph');
  const [converterViewMode, setConverterViewMode] = useState<'graph' | 'table'>('graph');

  // ==========================================
  // 1. REGEX CONVERTER STATE & LOGIC
  // ==========================================
  const [regexInput, setRegexInput] = useState('(a|b)*abb');
  const [mode, setMode] = useState<Mode>('RE_TO_DFA');
  const [converterError, setConverterError] = useState<string | null>(null);

  const conversionData = useMemo(() => {
    try {
      if (!regexInput) return null;
      setConverterError(null);

      const tokens = tokenize(regexInput);
      const parser = new Parser(tokens);
      const ast = parser.parse();
      const enfa = compileASTToENFA(ast);
      const nfa = eliminateEpsilon(enfa);
      const dfa = compileToDFA(nfa);
      const minDfa = minimizeDFA(dfa);
      const finalRe = generateRegex(minDfa);

      return {
        enfa,
        nfa,
        dfa,
        minDfa,
        finalRe
      };
    } catch (e: any) {
      setConverterError(e.message || 'Invalid Regular Expression');
      return null;
    }
  }, [regexInput]);

  // Scrubbable stage timeline — every stage up to and including the
  // currently selected `mode` is a real, already-computed pipeline output.
  // This is what makes "Conversion Steps" draggable/steppable instead of a
  // static checklist: clicking or scrubbing a pill swaps the actual graph.
  const converterStages: ConverterStage[] = useMemo(() => {
    if (!conversionData) return [];
    const stages: ConverterStage[] = [{ label: 'ε-NFA (Thompson construction)', automaton: conversionData.enfa }];
    if (mode === 'RE_TO_ENFA') return stages;
    stages.push({ label: 'NFA (ε eliminated)', automaton: conversionData.nfa });
    if (mode === 'RE_TO_NFA') return stages;
    stages.push({ label: 'DFA (subset construction)', automaton: conversionData.dfa });
    if (mode === 'RE_TO_DFA') return stages;
    stages.push({ label: 'Minimal DFA (Hopcroft)', automaton: conversionData.minDfa });
    if (mode === 'RE_TO_MINDFA') return stages;
    stages.push({ label: 'Regex (state elimination)', regex: conversionData.finalRe });
    return stages;
  }, [conversionData, mode]);

  // null = "not scrubbing, show the mode's own final stage" (unchanged
  // default behavior). Set to an index the moment the user clicks a pill,
  // a prev/next arrow, or hits play.
  const [previewStageIndex, setPreviewStageIndex] = useState<number | null>(null);
  const [stagePlaying, setStagePlaying] = useState(false);
  const activeStageIndex = previewStageIndex ?? Math.max(0, converterStages.length - 1);

  // Leaving scrub mode whenever the underlying pipeline changes (new regex
  // or new mode) — an old stage index could point at a stage that no
  // longer exists (e.g. switching from RE_TO_MINDFA to RE_TO_ENFA).
  useEffect(() => {
    setPreviewStageIndex(null);
    setStagePlaying(false);
  }, [regexInput, mode]);

  useEffect(() => {
    if (!stagePlaying) return;
    if (converterStages.length === 0) {
      setStagePlaying(false);
      return;
    }
    const id = setTimeout(() => {
      setPreviewStageIndex(prev => {
        const current = prev ?? 0;
        const next = current + 1;
        if (next >= converterStages.length) {
          setStagePlaying(false);
          return converterStages.length - 1;
        }
        return next;
      });
    }, 900);
    return () => clearTimeout(id);
  }, [stagePlaying, activeStageIndex, converterStages.length]);

  // Shared graph-rendering helper — every automaton stage (ENFA/NFA/DFA/MinDFA)
  // renders identically; this replaces the old per-mode duplicated node/edge
  // mapping code.
  const renderAutomatonGraph = (automaton: Automaton) => {
    const nodes = automaton.states.map((s) => ({
      id: s,
      label: s,
      isStart: s === automaton.startState,
      isAccept: automaton.acceptStates.includes(s)
    }));

    const edges = automaton.transitions.map((t, i) => ({
      id: i,
      from: t.from,
      to: t.to,
      label: t.label
    }));

    return <GraphView nodes={nodes} edges={edges} />;
  };

  const renderRegexResult = (regexStr: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', padding: '2rem', textAlign: 'center' }}>
      <h2 style={{ fontSize: '1.875rem', fontWeight: 'bold', marginBottom: '1rem', color: 'var(--accent)' }}>Final Regular Expression</h2>
      <div style={{ background: 'rgba(30,41,59,0.8)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--panel-border)', boxShadow: 'var(--glass-shadow)', fontSize: '1.5rem', fontFamily: 'var(--font-mono)', color: 'var(--primary)', width: '100%', maxWidth: '42rem', wordBreak: 'break-all' }}>
        {regexStr}
      </div>
      <p style={{ marginTop: '1.5rem', color: 'var(--text-muted)', maxWidth: '32rem' }}>
        This expression was generated by applying the State Elimination method to the minimized DFA. It represents the same language as the original input.
      </p>
    </div>
  );

  const renderConverterGraph = () => {
    if (!conversionData) return null;

    if (mode === 'RE_TO_ENFA') return renderAutomatonGraph(conversionData.enfa);
    if (mode === 'RE_TO_NFA') return renderAutomatonGraph(conversionData.nfa);
    if (mode === 'RE_TO_DFA') return renderAutomatonGraph(conversionData.dfa);
    if (mode === 'RE_TO_MINDFA') return renderAutomatonGraph(conversionData.minDfa);
    if (mode === 'DFA_TO_RE') return renderRegexResult(conversionData.finalRe);

    return null;
  };

  // Returns the actual Automaton object backing the current Converter mode,
  // or null for DFA_TO_RE (which has no automaton — just a regex string).
  // Used to feed TransitionTable in Table View, mirroring the Editor/Workspace
  // tabs' graph/table toggle pattern.
  const getConverterAutomaton = (): Automaton | null => {
    if (!conversionData) return null;
    if (mode === 'RE_TO_ENFA') return conversionData.enfa;
    if (mode === 'RE_TO_NFA') return conversionData.nfa;
    if (mode === 'RE_TO_DFA') return conversionData.dfa;
    if (mode === 'RE_TO_MINDFA') return conversionData.minDfa;
    return null;
  };

  const getConverterSteps = () => {
    if (!conversionData) return [];

    const base = [
      'Tokenized regular expression input',
      'Parsed tokens into Abstract Syntax Tree (AST)',
      "Compiled AST to ε-NFA via Thompson's construction"
    ];

    if (mode === 'RE_TO_ENFA') {
      return base;
    }
    if (mode === 'RE_TO_NFA') {
      return [...base, 'Eliminated epsilon transitions to produce epsilon-free NFA'];
    }
    if (mode === 'RE_TO_DFA') {
      return [
        ...base,
        'Eliminated epsilon transitions to produce NFA',
        'Applied subset construction to compile NFA to DFA (Regex → DFA shortcut)'
      ];
    }
    if (mode === 'RE_TO_MINDFA') {
      return [
        ...base,
        'Eliminated epsilon transitions to produce NFA',
        'Applied subset construction to compile NFA to DFA',
        "Minimized DFA via partition refinement (Hopcroft's algorithm)"
      ];
    }
    // DFA_TO_RE
    return [
      ...base,
      'Eliminated epsilon transitions to produce NFA',
      'Applied subset construction to compile NFA to DFA',
      "Minimized DFA using Hopcroft's algorithm",
      'Normalized minimal DFA to Generalized NFA (GNFA)',
      'Eliminated states sequentially to generate equivalent regular expression'
    ];
  };

  // Small color-coded legend so 'a', 'b', ... mean the same thing here as
  // they do in Graph View, the Transition Table, and the simulator trace.
  const renderAlphabetLegend = (alphabet: string[]) => {
    if (!alphabet || alphabet.length === 0) return null;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        {alphabet.map(sym => (
          <span
            key={sym}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.7rem',
              color: getSymbolColor(sym),
              border: `1px solid ${getSymbolColor(sym)}66`,
              borderRadius: '4px',
              padding: '0.15rem 0.4rem'
            }}
          >
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: getSymbolColor(sym), flexShrink: 0 }} />
            {sym}
          </span>
        ))}
      </div>
    );
  };

  // ==========================================
  // 2. CANVAS EDITOR STATE & LOGIC
  // ==========================================
  const [automaton, setAutomaton] = useState<Automaton>({
    type: 'DFA',
    states: ['q0'],
    alphabet: ['a', 'b'],
    transitions: [],
    startState: 'q0',
    acceptStates: []
  });

  // Editor selection state (identity-based selection for edges)
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Transition | null>(null);

  // Form Inputs
  const [stateInput, setStateInput] = useState('');
  const [renameInput, setRenameInput] = useState('');
  const [transitionFrom, setTransitionFrom] = useState('q0');
  const [transitionTo, setTransitionTo] = useState('q0');
  const [transitionLabel, setTransitionLabel] = useState('');

  // Simulation State
  const [simulationInput, setSimulationInput] = useState('');
  const [simulationResult, setSimulationResult] = useState<string | null>(null);
  // Step-through trace — only populated for DFAs (deterministic, so a
  // single unambiguous "current state" exists at every step). NFA/ENFA
  // still get an accept/reject verdict via simulationResult, just without
  // the live scrub — multiple active states at once doesn't map cleanly
  // onto "light up one node," and faking it would be misleading rather
  // than illustrative.
  const [simTrace, setSimTrace] = useState<SimStep[] | null>(null);
  const [simTraceIndex, setSimTraceIndex] = useState(0);
  const [simPlaying, setSimPlaying] = useState(false);

  // Error/Status banner state
  const [editorError, setEditorError] = useState<string | null>(null);

  // Lineage parent ID tracking
  const [loadedFromItemId, setLoadedFromItemId] = useState<string | null>(null);

  // Algorithms Panel state — equivalence check target + result
  const [canvasEquivTargetId, setCanvasEquivTargetId] = useState<string | null>(null);
  const [canvasEquivResult, setCanvasEquivResult] = useState<string | null>(null);

  // Identity-based transition selection lookup
  const currentSelectedEdge = useMemo(() => {
    if (!selectedEdge) return null;
    return automaton.transitions.find(
      t => t.from === selectedEdge.from && t.to === selectedEdge.to && t.label === selectedEdge.label
    ) || null;
  }, [selectedEdge, automaton.transitions]);

  // Graph data mapping
  const graphData = useMemo(() => {
    const nodes = automaton.states.map(s => {
      const isStart = s === automaton.startState;
      const isAccept = automaton.acceptStates.includes(s);
      return {
        id: s,
        label: s,
        isStart,
        isAccept
      };
    });

    const edges = automaton.transitions.map((t, idx) => ({
      id: idx,
      from: t.from,
      to: t.to,
      label: t.label
    }));

    return { nodes, edges };
  }, [automaton]);

  // Any structural edit invalidates a running trace's node/edge indices —
  // clear it rather than risk highlighting a state or edge that moved.
  useEffect(() => {
    setSimTrace(null);
    setSimTraceIndex(0);
    setSimPlaying(false);
  }, [automaton]);

  useEffect(() => {
    if (!simPlaying || !simTrace) return;
    if (simTraceIndex >= simTrace.length - 1) {
      setSimPlaying(false);
      return;
    }
    const id = setTimeout(() => setSimTraceIndex(i => Math.min(i + 1, simTrace.length - 1)), 700);
    return () => clearTimeout(id);
  }, [simPlaying, simTrace, simTraceIndex]);

  // Index into automaton.transitions of the edge just taken to reach the
  // currently-displayed trace step, so GraphView can light up that exact
  // edge (matching graphData's index-based edge ids) rather than guessing.
  const activeEdgeIndex = useMemo(() => {
    if (!simTrace || simTraceIndex === 0) return null;
    const prev = simTrace[simTraceIndex - 1];
    const curr = simTrace[simTraceIndex];
    const idx = automaton.transitions.findIndex(t => t.from === prev.state && t.to === curr.state && t.label === curr.symbol);
    return idx === -1 ? null : idx;
  }, [simTrace, simTraceIndex, automaton.transitions]);

  const activeSimState = simTrace ? simTrace[simTraceIndex].state : null;

  // Selection handlers
  const handleSelectNode = (nodeId: string) => {
    setSelectedNode(nodeId);
    setSelectedEdge(null);
    setRenameInput(nodeId);
  };

  const handleSelectEdge = (edgeIdx: number) => {
    const t = automaton.transitions[edgeIdx];
    if (t) {
      setSelectedEdge({ from: t.from, to: t.to, label: t.label });
    }
    setSelectedNode(null);
  };

  const handleDeselect = () => {
    setSelectedNode(null);
    setSelectedEdge(null);
  };

  // Transaction Rollback wrappers
  const handleAddState = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setEditorError(null);
      const next = applyAddState(automaton, stateInput.trim());
      setAutomaton(next);
      setStateInput('');
    } catch (err: any) {
      setEditorError(err.message || 'Failed to add state.');
    }
  };

  const handleDeleteState = () => {
    if (!selectedNode) return;
    try {
      setEditorError(null);
      const next = applyDeleteState(automaton, selectedNode);
      setAutomaton(next);
      handleDeselect();
    } catch (err: any) {
      setEditorError(err.message || 'Failed to delete state.');
    }
  };

  const handleRenameState = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode) return;
    try {
      setEditorError(null);
      const next = applyRenameState(automaton, selectedNode, renameInput.trim());
      setAutomaton(next);
      handleDeselect();
    } catch (err: any) {
      setEditorError(err.message || 'Failed to rename state.');
    }
  };

  const handleAddTransition = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setEditorError(null);
      const label = transitionLabel.trim() === '' ? EPSILON : transitionLabel.trim();
      const next = applyAddTransition(automaton, transitionFrom, transitionTo, label);
      setAutomaton(next);
      setTransitionLabel('');
    } catch (err: any) {
      setEditorError(err.message || 'Failed to add transition.');
    }
  };

  const handleDeleteTransition = () => {
    if (!selectedEdge) return;
    try {
      setEditorError(null);
      const next = applyDeleteTransition(automaton, selectedEdge.from, selectedEdge.to, selectedEdge.label);
      setAutomaton(next);
      handleDeselect();
    } catch (err: any) {
      setEditorError(err.message || 'Failed to delete transition.');
    }
  };

  const handleSetStart = () => {
    if (!selectedNode) return;
    try {
      setEditorError(null);
      const next = applySetStartState(automaton, selectedNode);
      setAutomaton(next);
    } catch (err: any) {
      setEditorError(err.message || 'Failed to set start state.');
    }
  };

  const handleToggleAccept = () => {
    if (!selectedNode) return;
    try {
      setEditorError(null);
      const next = applyToggleAcceptState(automaton, selectedNode);
      setAutomaton(next);
    } catch (err: any) {
      setEditorError(err.message || 'Failed to toggle accept state.');
    }
  };

  const handleEditorSimulate = (e: React.FormEvent) => {
    e.preventDefault();
    setSimPlaying(false);
    try {
      setEditorError(null);
      if (automaton.type === 'DFA') {
        const { trace, accepted, error } = computeDfaTrace(automaton, simulationInput);
        setSimTrace(trace);
        setSimTraceIndex(0);
        setSimulationResult(error ? `ERROR: ${error}` : (accepted ? 'ACCEPTED' : 'REJECTED'));
      } else {
        setSimTrace(null);
        let accepted = false;
        if (automaton.type === 'NFA') {
          accepted = simulateNFA(automaton, simulationInput).accepted;
        } else {
          accepted = simulateENFA(automaton, simulationInput).accepted;
        }
        setSimulationResult(accepted ? 'ACCEPTED' : 'REJECTED');
      }
    } catch (err: any) {
      setSimTrace(null);
      setSimulationResult(`ERROR: ${err.message}`);
    }
  };

  // ------------------------------------------------------------------
  // ALGORITHMS PANEL — runs the core Mission 1-9 algorithms directly on
  // whatever automaton is currently loaded in the canvas (hand-built or
  // edited), independent of the Regex Converter pipeline. This closes the
  // gap where subset construction / epsilon-elimination / minimization /
  // equivalence-checking were only reachable via a regex, never via an
  // arbitrary automaton the user built or edited by hand.
  // ------------------------------------------------------------------

  // Standalone ε-NFA -> NFA (real epsilon elimination), canvas automaton only.
  const handleCanvasEliminateEpsilon = () => {
    try {
      setEditorError(null);
      if (automaton.type !== 'ENFA') {
        throw new Error('Epsilon elimination requires an ε-NFA.');
      }
      const next = eliminateEpsilon(automaton);
      setAutomaton(next);
      handleDeselect();
    } catch (err: any) {
      setEditorError(err.message || 'Failed to eliminate epsilon transitions.');
    }
  };

  // NFA -> ε-NFA relabel. Structurally a no-op: every NFA already satisfies
  // the ε-NFA definition (ε-NFA just permits, but doesn't require, epsilon
  // transitions), so this is a type-tag change only — same honest pattern
  // as relabelDFAToNFA, kept inline since it's a one-line retag, not an
  // algorithm with its own file.
  const handleCanvasRelabelToENFA = () => {
    try {
      setEditorError(null);
      if (automaton.type !== 'NFA') {
        throw new Error('Only an NFA can be relabeled as an ε-NFA.');
      }
      const relabeled: Automaton = { ...automaton, type: 'ENFA' };
      validateAutomaton(relabeled);
      setAutomaton(relabeled);
      handleDeselect();
    } catch (err: any) {
      setEditorError(err.message || 'Failed to relabel NFA to ε-NFA.');
    }
  };

  // Standalone NFA -> DFA (real subset construction), canvas automaton only.
  const handleCanvasNFAtoDFA = () => {
    try {
      setEditorError(null);
      if (automaton.type !== 'NFA') {
        throw new Error('Subset construction requires an epsilon-free NFA.');
      }
      const next = compileToDFA(automaton);
      setAutomaton(next);
      handleDeselect();
    } catch (err: any) {
      setEditorError(err.message || 'Failed to convert NFA to DFA.');
    }
  };

  // DFA -> NFA relabel, same relabelDFAToNFA util the Converter/Workspace
  // tabs already use, exposed here too so it's reachable without leaving
  // the Canvas Editor.
  const handleCanvasRelabelToNFA = () => {
    try {
      setEditorError(null);
      if (automaton.type !== 'DFA') {
        throw new Error('Only a DFA can be relabeled as an NFA.');
      }
      const relabeled = relabelDFAToNFA(automaton);
      setAutomaton(relabeled);
      handleDeselect();
    } catch (err: any) {
      setEditorError(err.message || 'Failed to relabel DFA to NFA.');
    }
  };

  // Standalone DFA -> Minimal DFA, canvas automaton only.
  const handleCanvasMinimize = () => {
    try {
      setEditorError(null);
      if (automaton.type !== 'DFA') {
        throw new Error('Minimization requires a DFA.');
      }
      const next = minimizeDFA(automaton);
      setAutomaton(next);
      handleDeselect();
    } catch (err: any) {
      setEditorError(err.message || 'Failed to minimize DFA.');
    }
  };

  // Check language equivalence between the canvas DFA and a chosen
  // DFA-typed Workspace item, using the real Mission 9 product-automaton
  // checker (not simulator sampling).
  const handleCanvasCheckEquivalence = () => {
    if (!canvasEquivTargetId) return;
    const target = workspaceItems.find(i => i.id === canvasEquivTargetId);
    if (!target || target.payload.kind !== 'automaton') return;

    try {
      setEditorError(null);
      const result = areEquivalent(automaton, target.payload.automaton);
      if (result.equivalent) {
        setCanvasEquivResult('Equivalent: both accept exactly the same language.');
      } else {
        setCanvasEquivResult(`Not equivalent — counterexample: "${result.counterexample}"`);
      }
    } catch (err: any) {
      setEditorError(err.message || 'Equivalence check failed.');
      setCanvasEquivResult(null);
    }
  };

  const handleSaveToWorkspace = () => {
    try {
      setEditorError(null);
      validateAutomaton(automaton);

      const newItem: WorkspaceItem = {
        id: generateUUID(),
        label: `Canvas Save (${automaton.type})`,
        parentId: loadedFromItemId,
        createdBy: 'canvasSave',
        payload: {
          kind: 'automaton',
          automaton: {
            type: automaton.type,
            states: [...automaton.states],
            alphabet: [...automaton.alphabet],
            transitions: automaton.transitions.map(t => ({ ...t })),
            startState: automaton.startState,
            acceptStates: [...automaton.acceptStates]
          }
        }
      };

      setWorkspaceItems(prev => [...prev, newItem]);
      alert('Saved current canvas to Workspace successfully!');
    } catch (err: any) {
      setEditorError(err.message || 'Failed to save canvas.');
    }
  };

  // Relabel the currently-viewed DFA/Minimal DFA stage as an NFA and load it
  // straight into the Canvas Editor for manual editing. Only meaningful from
  // RE_TO_DFA or RE_TO_MINDFA mode, where conversionData.dfa / .minDfa exist.
  const handleRelabelAndEdit = () => {
    if (!conversionData) return;
    try {
      setConverterError(null);
      const sourceDfa = mode === 'RE_TO_MINDFA' ? conversionData.minDfa : conversionData.dfa;
      const relabeled = relabelDFAToNFA(sourceDfa);
      setAutomaton(relabeled);
      setLoadedFromItemId(null); // fresh lineage — not loaded from a workspace item
      setActiveTab('EDITOR');
      setEditorError(null);
      handleDeselect();
    } catch (err: any) {
      setConverterError(err.message || 'Failed to relabel DFA to NFA.');
    }
  };

  // ==========================================
  // 3. WORKSPACE REPOSITORY STATE & LOGIC
  // ==========================================
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItem[]>([]);
  const [selectedItemAId, setSelectedItemAId] = useState<string | null>(null);
  const [selectedItemBId, setSelectedItemBId] = useState<string | null>(null);
  const [newRegexInput, setNewRegexInput] = useState('');
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [equivalenceResult, setEquivalenceResult] = useState<string | null>(null);

  // Lineage action transaction wrappers (rollback contract)
  const handleAddWorkspaceRegex = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setWorkspaceError(null);
      const next = addRegexToWorkspace(workspaceItems, newRegexInput.trim());
      setWorkspaceItems(next);
      setNewRegexInput('');
    } catch (err: any) {
      setWorkspaceError(err.message || 'Failed to add regex.');
    }
  };

  const handleCompileRegex = (itemId: string) => {
    try {
      setWorkspaceError(null);
      const next = compileRegexInWorkspace(workspaceItems, itemId);
      setWorkspaceItems(next);
    } catch (err: any) {
      setWorkspaceError(err.message || 'Failed to compile regex.');
    }
  };

  const handleEliminateEpsilon = (itemId: string) => {
    try {
      setWorkspaceError(null);
      const next = eliminateEpsilonInWorkspace(workspaceItems, itemId);
      setWorkspaceItems(next);
    } catch (err: any) {
      setWorkspaceError(err.message || 'Failed to eliminate epsilon.');
    }
  };

  const handleSubsetConstruction = (itemId: string) => {
    try {
      setWorkspaceError(null);
      const next = subsetConstructionInWorkspace(workspaceItems, itemId);
      setWorkspaceItems(next);
    } catch (err: any) {
      setWorkspaceError(err.message || 'Failed subset construction.');
    }
  };

  const handleMinimize = (itemId: string) => {
    try {
      setWorkspaceError(null);
      const next = minimizeInWorkspace(workspaceItems, itemId);
      setWorkspaceItems(next);
    } catch (err: any) {
      setWorkspaceError(err.message || 'Failed to minimize DFA.');
    }
  };

  const handleGenerateRegex = (itemId: string) => {
    try {
      setWorkspaceError(null);
      const next = generateRegexInWorkspace(workspaceItems, itemId);
      setWorkspaceItems(next);
    } catch (err: any) {
      setWorkspaceError(err.message || 'Failed to generate regex.');
    }
  };

  // Relabel a workspace DFA item as an NFA and load directly into the canvas.
  const handleRelabelWorkspaceItem = (item: WorkspaceItem) => {
    if (item.payload.kind !== 'automaton') return;
    try {
      setWorkspaceError(null);
      const relabeled = relabelDFAToNFA(item.payload.automaton);
      setAutomaton(relabeled);
      setLoadedFromItemId(item.id);
      setActiveTab('EDITOR');
      setEditorError(null);
      handleDeselect();
    } catch (err: any) {
      setWorkspaceError(err.message || 'Failed to relabel DFA to NFA.');
    }
  };

  const handleLoadIntoEditor = (item: WorkspaceItem) => {
    if (item.payload.kind === 'automaton') {
      const aut = item.payload.automaton;
      setAutomaton({
        type: aut.type,
        states: [...aut.states],
        alphabet: [...aut.alphabet],
        transitions: aut.transitions.map(t => ({ ...t })),
        startState: aut.startState,
        acceptStates: [...aut.acceptStates]
      });
      setLoadedFromItemId(item.id);
      setActiveTab('EDITOR');
      setEditorError(null);
      handleDeselect();
    }
  };

  const handleVerifyEquivalence = () => {
    if (!selectedItemAId || !selectedItemBId) return;
    const itemA = workspaceItems.find(i => i.id === selectedItemAId);
    const itemB = workspaceItems.find(i => i.id === selectedItemBId);
    if (!itemA || !itemB) return;

    try {
      setWorkspaceError(null);
      const result = compareWorkspaceItems(itemA, itemB);
      if (result.equivalent) {
        setEquivalenceResult('Equivalent: Both items accept exactly the same language.');
      } else {
        setEquivalenceResult(`Not equivalent — counterexample: "${result.counterexample}"`);
      }
    } catch (err: any) {
      setWorkspaceError(err.message || 'Comparison failed.');
      setEquivalenceResult(null);
    }
  };

  // Memoized rendering mapping for Selected Items
  const selectedItemA = useMemo(() => {
    return workspaceItems.find(i => i.id === selectedItemAId) || null;
  }, [selectedItemAId, workspaceItems]);

  const selectedItemB = useMemo(() => {
    return workspaceItems.find(i => i.id === selectedItemBId) || null;
  }, [selectedItemBId, workspaceItems]);

  // Render a workspace item visual preview
  const renderItemPreview = (item: WorkspaceItem | null, viewMode: 'graph' | 'table' = 'graph') => {
    if (!item) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No item selected
        </div>
      );
    }

    if (item.payload.kind === 'regex') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', padding: '1rem', textAlign: 'center' }}>
          <h4 style={{ color: 'var(--accent)', margin: '0 0 1rem 0', fontSize: '1.1rem' }}>{item.label}</h4>
          <div style={{ background: 'rgba(30,41,59,0.8)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '1.25rem', fontFamily: 'var(--font-mono)', color: 'var(--primary)', width: '100%', maxWidth: '30rem', wordBreak: 'break-all' }}>
            {item.payload.regexString}
          </div>
        </div>
      );
    }

    const aut = item.payload.automaton;

    if (viewMode === 'table') {
      return <TransitionTable automaton={aut} />;
    }

    const nodes = aut.states.map(s => ({
      id: s,
      label: s,
      isStart: s === aut.startState,
      isAccept: aut.acceptStates.includes(s)
    }));
    const edges = aut.transitions.map((t, idx) => ({
      id: idx,
      from: t.from,
      to: t.to,
      label: t.label
    }));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 1rem', background: 'rgba(15,23,42,0.4)', borderBottom: '1px solid var(--panel-border)', fontSize: '0.85rem' }}>
          <span>{item.label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--accent)' }}>Type: {aut.type}</span>
            {aut.type === 'DFA' && (
              <button
                onClick={() => handleRelabelWorkspaceItem(item)}
                className="btn"
                title="Relabel this DFA as an NFA and edit it on the canvas"
                style={{ padding: '0.1rem 0.4rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                <Shuffle size={12} /> DFA → NFA
              </button>
            )}
          </div>
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          <GraphView nodes={nodes} edges={edges} />
        </div>
      </div>
    );
  };

  return (
    <div className="app-container">
      {/* Header Tabs */}
      <header className="header glass-panel">
        <h1 className="title m-0 text-2xl" style={{ margin: 0 }}>Automata Lab</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            className={`btn ${activeTab === 'CONVERTER' ? 'btn-accent' : ''}`}
            onClick={() => setActiveTab('CONVERTER')}
          >
            Regex Converter
          </button>
          <button
            className={`btn ${activeTab === 'EDITOR' ? 'btn-accent' : ''}`}
            onClick={() => setActiveTab('EDITOR')}
          >
            Canvas Editor
          </button>
          <button
            className={`btn ${activeTab === 'WORKSPACE' ? 'btn-accent' : ''}`}
            onClick={() => setActiveTab('WORKSPACE')}
          >
            Workspace Repository
          </button>
        </div>
      </header>

      {/* RENDER CONVERTER TAB */}
      {activeTab === 'CONVERTER' && (
        <main className="main-content">
          <aside className="controls-sidebar glass-panel">
            <div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Settings size={18} /> Configuration
              </h3>
              <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Regular Expression</label>
              <input
                type="text"
                className="input-field"
                value={regexInput}
                onChange={(e) => setRegexInput(e.target.value)}
                placeholder="e.g. (a|b)*abb"
              />
              {converterError && <div style={{ color: '#f87171', marginTop: '0.5rem', fontSize: '0.875rem' }}>{converterError}</div>}
              {conversionData && (
                <div style={{ marginTop: '0.6rem' }}>
                  {renderAlphabetLegend(conversionData.enfa.alphabet)}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', width: '100%' }}>
              <button
                className={`btn ${mode === 'RE_TO_ENFA' ? 'btn-accent' : ''}`}
                onClick={() => setMode('RE_TO_ENFA')}
                style={{ flex: '1 1 30%', fontSize: '0.75rem', padding: '0.5rem 0' }}
              >
                RE → ε-NFA
              </button>
              <button
                className={`btn ${mode === 'RE_TO_NFA' ? 'btn-accent' : ''}`}
                onClick={() => setMode('RE_TO_NFA')}
                style={{ flex: '1 1 30%', fontSize: '0.75rem', padding: '0.5rem 0' }}
              >
                RE → NFA
              </button>
              <button
                className={`btn ${mode === 'RE_TO_DFA' ? 'btn-accent' : ''}`}
                onClick={() => setMode('RE_TO_DFA')}
                style={{ flex: '1 1 30%', fontSize: '0.75rem', padding: '0.5rem 0' }}
              >
                RE → DFA
              </button>
              <button
                className={`btn ${mode === 'RE_TO_MINDFA' ? 'btn-accent' : ''}`}
                onClick={() => setMode('RE_TO_MINDFA')}
                style={{ flex: '1 1 30%', fontSize: '0.75rem', padding: '0.5rem 0' }}
              >
                Minimal DFA
              </button>
              <button
                className={`btn ${mode === 'DFA_TO_RE' ? 'btn-accent' : ''}`}
                onClick={() => setMode('DFA_TO_RE')}
                style={{ flex: '1 1 30%', fontSize: '0.75rem', padding: '0.5rem 0' }}
              >
                DFA → RE
              </button>
            </div>

            {(mode === 'RE_TO_DFA' || mode === 'RE_TO_MINDFA') && conversionData && (
              <button
                onClick={handleRelabelAndEdit}
                className="btn"
                style={{ width: '100%', fontSize: '0.8rem', padding: '0.5rem 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              >
                <Shuffle size={14} /> Relabel as NFA & Edit in Canvas
              </button>
            )}

            <div className="steps-panel" style={{ background: 'rgba(30,41,59,0.5)', borderRadius: '8px', flex: 1, overflowY: 'auto' }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
                <Info size={18} /> Conversion Steps
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {getConverterSteps().map((step, idx) => (
                  <div key={idx} className="step-item">
                    <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', marginRight: '0.5rem' }}>{idx + 1}.</span> {step}
                  </div>
                ))}
                {getConverterSteps().length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', fontStyle: 'italic' }}>Enter a valid regex to see steps.</div>
                )}
              </div>
            </div>
          </aside>

          <section className="visualization-area glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Scrubbable stage timeline — click a pill, step with the
                arrows, or hit play to watch the pipeline advance stage by
                stage. Every stage shown is a real computed automaton, not
                an interpolated animation. */}
            {conversionData && converterStages.length > 0 && (
              <div className="stage-timeline" style={{ padding: '0.5rem 1rem', background: 'rgba(15,23,42,0.4)', borderBottom: '1px solid var(--panel-border)' }}>
                <button
                  className="btn"
                  style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }}
                  onClick={() => { setPreviewStageIndex(Math.max(0, activeStageIndex - 1)); setStagePlaying(false); }}
                  disabled={activeStageIndex === 0}
                  title="Previous stage"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  className={`btn ${stagePlaying ? 'btn-live' : ''}`}
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}
                  onClick={() => {
                    if (stagePlaying) {
                      setStagePlaying(false);
                    } else {
                      setPreviewStageIndex(activeStageIndex >= converterStages.length - 1 ? 0 : activeStageIndex);
                      setStagePlaying(true);
                    }
                  }}
                  title={stagePlaying ? 'Pause' : 'Play through stages'}
                >
                  {stagePlaying ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                  className="btn"
                  style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }}
                  onClick={() => { setPreviewStageIndex(Math.min(converterStages.length - 1, activeStageIndex + 1)); setStagePlaying(false); }}
                  disabled={activeStageIndex === converterStages.length - 1}
                  title="Next stage"
                >
                  <ChevronRight size={14} />
                </button>

                {converterStages.map((stage, i) => (
                  <button
                    key={stage.label}
                    className={`stage-pill ${i === activeStageIndex ? 'stage-pill-active' : (i < activeStageIndex ? 'stage-pill-done' : '')}`}
                    onClick={() => { setPreviewStageIndex(i); setStagePlaying(false); }}
                  >
                    {i + 1}. {stage.label}
                  </button>
                ))}

                {previewStageIndex !== null && (
                  <button
                    className="btn"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    onClick={() => { setPreviewStageIndex(null); setStagePlaying(false); }}
                    title="Return to the mode's default view"
                  >
                    <RotateCcw size={12} /> Live view
                  </button>
                )}
              </div>
            )}

            {mode !== 'DFA_TO_RE' && (
              <div style={{ padding: '0.5rem 1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', background: 'rgba(15,23,42,0.4)', borderBottom: '1px solid var(--panel-border)' }}>
                <button
                  className={`btn ${converterViewMode === 'graph' ? 'btn-accent' : ''}`}
                  onClick={() => setConverterViewMode('graph')}
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                >
                  Graph View
                </button>
                <button
                  className={`btn ${converterViewMode === 'table' ? 'btn-accent' : ''}`}
                  onClick={() => setConverterViewMode('table')}
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                >
                  Table View
                </button>
              </div>
            )}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              {previewStageIndex !== null && converterStages[previewStageIndex] ? (
                converterStages[previewStageIndex].automaton ? (
                  converterViewMode === 'table'
                    ? <TransitionTable automaton={converterStages[previewStageIndex].automaton!} />
                    : renderAutomatonGraph(converterStages[previewStageIndex].automaton!)
                ) : (
                  renderRegexResult(converterStages[previewStageIndex].regex!)
                )
              ) : (
                mode === 'DFA_TO_RE' || converterViewMode === 'graph'
                  ? renderConverterGraph()
                  : (getConverterAutomaton() ? <TransitionTable automaton={getConverterAutomaton()!} /> : renderConverterGraph())
              )}
            </div>
          </section>
        </main>
      )}

      {/* RENDER CANVAS EDITOR TAB */}
      {activeTab === 'EDITOR' && (
        <main className="main-content">
          <aside className="controls-sidebar glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                  <Settings size={18} /> Toolbar Panel
                </h3>
                <button onClick={handleSaveToWorkspace} className="btn btn-accent" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>
                  Save to Workspace
                </button>
              </div>
              <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
                Type: <strong>{automaton.type}</strong> {loadedFromItemId && <span style={{ color: 'var(--accent)', marginLeft: '0.5rem' }}>(Lineage Active)</span>}
              </div>
              <div style={{ marginBottom: '1rem' }}>
                {renderAlphabetLegend(automaton.alphabet)}
              </div>

              {editorError && (
                <div style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', padding: '0.75rem', borderRadius: '6px', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  {editorError}
                </div>
              )}

              {/* Form to Add State */}
              <form onSubmit={handleAddState} style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Create State</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    className="input-field"
                    value={stateInput}
                    onChange={(e) => setStateInput(e.target.value)}
                    placeholder="e.g. q1"
                    style={{ flex: 1 }}
                  />
                  <button type="submit" className="btn btn-accent" style={{ padding: '0.5rem' }}>
                    <Plus size={18} />
                  </button>
                </div>
              </form>

              {/* Form to Add Transition */}
              <form onSubmit={handleAddTransition} style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Add Transition</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <select
                      className="input-field"
                      value={transitionFrom}
                      onChange={(e) => setTransitionFrom(e.target.value)}
                      style={{ flex: 1 }}
                    >
                      {automaton.states.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <span style={{ alignSelf: 'center', color: 'var(--text-muted)' }}>→</span>
                    <select
                      className="input-field"
                      value={transitionTo}
                      onChange={(e) => setTransitionTo(e.target.value)}
                      style={{ flex: 1 }}
                    >
                      {automaton.states.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      className="input-field"
                      value={transitionLabel}
                      onChange={(e) => setTransitionLabel(e.target.value)}
                      placeholder="Symbol (empty = ε)"
                      style={{ flex: 1 }}
                    />
                    <button type="submit" className="btn btn-accent" style={{ padding: '0.5rem 1rem' }}>
                      Connect
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Context-aware selected actions — only rendered once
                something is actually selected; nothing shown otherwise. */}
            {(selectedNode || currentSelectedEdge) && (
              <div style={{ background: 'rgba(30,41,59,0.5)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: 'var(--primary)' }}>Context Actions</h4>

                {selectedNode && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ fontSize: '0.875rem' }}>Selected: <strong>{selectedNode}</strong></div>

                    <form onSubmit={handleRenameState} style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        className="input-field"
                        value={renameInput}
                        onChange={(e) => setRenameInput(e.target.value)}
                        style={{ flex: 1, height: '2rem', fontSize: '0.875rem' }}
                      />
                      <button type="submit" className="btn btn-accent" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>Rename</button>
                    </form>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={handleSetStart} className="btn" style={{ flex: 1, fontSize: '0.75rem', gap: '0.25rem', padding: '0.5rem 0' }}>
                        <UserCheck size={14} /> Start
                      </button>
                      <button onClick={handleToggleAccept} className="btn" style={{ flex: 1, fontSize: '0.75rem', gap: '0.25rem', padding: '0.5rem 0' }}>
                        <ShieldCheck size={14} /> Accept
                      </button>
                    </div>

                    <button onClick={handleDeleteState} className="btn" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)', fontSize: '0.75rem', gap: '0.25rem', justifyContent: 'center' }}>
                      <Trash2 size={14} /> Delete State
                    </button>
                  </div>
                )}

                {currentSelectedEdge && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ fontSize: '0.875rem' }}>
                      Selected edge: <strong>{`${currentSelectedEdge.from} --${currentSelectedEdge.label}--> ${currentSelectedEdge.to}`}</strong>
                    </div>
                    <button onClick={handleDeleteTransition} className="btn" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)', fontSize: '0.75rem', gap: '0.25rem', justifyContent: 'center' }}>
                      <Trash2 size={14} /> Delete Edge
                    </button>
                  </div>
                )}

              </div>
            )}

            {/* Simulation Widget — for DFAs this now drives a live,
                step-through trace (glowing current state + colored active
                edge on the graph, consumed/remaining input coloring here)
                instead of only reporting the final verdict. */}
            <div className="steps-panel" style={{ background: 'rgba(30,41,59,0.3)', borderRadius: '8px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--primary)', margin: 0 }}>
                <Play size={14} /> Quick Simulator
              </h3>
              <form onSubmit={handleEditorSimulate} style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="input-field"
                  value={simulationInput}
                  onChange={(e) => setSimulationInput(e.target.value)}
                  placeholder="Test string (e.g. ab)"
                  style={{ flex: 1 }}
                />
                <button type="submit" className="btn btn-accent" style={{ padding: '0.5rem' }}>
                  Run
                </button>
              </form>

              {simTrace && (
                <>
                  {/* Consumed characters take on their symbol's color; the
                      one that produced the currently-shown step is bold +
                      underlined; remaining characters stay dim. */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', fontFamily: 'var(--font-mono)', fontSize: '0.95rem', padding: '0.4rem 0' }}>
                    {simulationInput.split('').map((ch, i) => {
                      const consumed = i < simTraceIndex;
                      const isCurrent = i === simTraceIndex - 1;
                      return (
                        <span
                          key={i}
                          style={{
                            color: consumed ? getSymbolColor(ch) : 'var(--text-dim)',
                            fontWeight: isCurrent ? 700 : 400,
                            textDecoration: isCurrent ? 'underline' : 'none'
                          }}
                        >
                          {ch}
                        </span>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '0.3rem', fontSize: '0.7rem' }}
                      onClick={() => { setSimPlaying(false); setSimTraceIndex(i => Math.max(0, i - 1)); }}
                      disabled={simTraceIndex === 0}
                      title="Step back"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      className={`btn ${simPlaying ? 'btn-live' : ''}`}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', flex: 1 }}
                      onClick={() => setSimPlaying(p => !p)}
                      disabled={simTraceIndex >= simTrace.length - 1 && !simPlaying}
                    >
                      {simPlaying ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '0.3rem', fontSize: '0.7rem' }}
                      onClick={() => { setSimPlaying(false); setSimTraceIndex(i => Math.min(simTrace.length - 1, i + 1)); }}
                      disabled={simTraceIndex >= simTrace.length - 1}
                      title="Step forward"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                    Step {simTraceIndex} / {simTrace.length - 1} — current state <strong style={{ color: '#facc15' }}>{activeSimState}</strong>
                  </div>
                </>
              )}

              {!simTrace && automaton.type !== 'DFA' && simulationResult && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  Live step-through is available for DFAs. {automaton.type} verdicts show below.
                </div>
              )}

              {simulationResult && (
                <div style={{ fontSize: '0.875rem', fontWeight: 'bold', padding: '0.5rem', borderRadius: '4px', background: 'rgba(30,41,59,0.6)', border: '1px solid var(--panel-border)', textAlign: 'center', color: simulationResult.startsWith('ERROR') ? '#f87171' : (simulationResult === 'ACCEPTED' ? '#34d399' : '#94a3b8') }}>
                  Result: {simulationResult}
                </div>
              )}
            </div>

            {/* Algorithms Panel — runs subset construction, epsilon
                elimination, minimization, relabeling, and equivalence
                checking directly on whatever automaton is currently in
                the canvas, not just on regex-pipeline output. */}
            <div className="steps-panel" style={{ background: 'rgba(30,41,59,0.3)', borderRadius: '8px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)', margin: 0 }}>
                <GitCommit size={16} /> Algorithms
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                <button
                  onClick={handleCanvasEliminateEpsilon}
                  className="btn"
                  disabled={automaton.type !== 'ENFA'}
                  title="Eliminate Epsilon"
                  style={{ fontSize: '0.68rem', padding: '0.45rem 0.2rem', lineHeight: 1.2 }}
                >
                  ε-NFA → NFA
                </button>
                <button
                  onClick={handleCanvasRelabelToENFA}
                  className="btn"
                  disabled={automaton.type !== 'NFA'}
                  title="Relabel"
                  style={{ fontSize: '0.68rem', padding: '0.45rem 0.2rem', lineHeight: 1.2 }}
                >
                  NFA → ε-NFA
                </button>
                <button
                  onClick={handleCanvasNFAtoDFA}
                  className="btn"
                  disabled={automaton.type !== 'NFA'}
                  title="Subset Construction"
                  style={{ fontSize: '0.68rem', padding: '0.45rem 0.2rem', lineHeight: 1.2 }}
                >
                  NFA → DFA
                </button>
                <button
                  onClick={handleCanvasRelabelToNFA}
                  className="btn"
                  disabled={automaton.type !== 'DFA'}
                  title="Relabel"
                  style={{ fontSize: '0.68rem', padding: '0.45rem 0.2rem', lineHeight: 1.2 }}
                >
                  DFA → NFA
                </button>
                <button
                  onClick={handleCanvasMinimize}
                  className="btn"
                  disabled={automaton.type !== 'DFA'}
                  title="Partition Refinement (Hopcroft's algorithm)"
                  style={{ fontSize: '0.68rem', padding: '0.45rem 0.2rem', lineHeight: 1.2, gridColumn: '1 / -1' }}
                >
                  DFA → Minimal DFA
                </button>
              </div>

              <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Check Equivalence vs Workspace DFA</label>
                <select
                  className="input-field"
                  value={canvasEquivTargetId || ''}
                  onChange={(e) => setCanvasEquivTargetId(e.target.value || null)}
                  style={{ fontSize: '0.78rem' }}
                >
                  <option value="">Select a DFA item…</option>
                  {workspaceItems
                    .filter(i => i.payload.kind === 'automaton' && i.payload.automaton.type === 'DFA')
                    .map(i => (
                      <option key={i.id} value={i.id}>{i.label}</option>
                    ))}
                </select>
                <button
                  onClick={handleCanvasCheckEquivalence}
                  className="btn btn-accent"
                  disabled={automaton.type !== 'DFA' || !canvasEquivTargetId}
                  style={{ width: '100%', fontSize: '0.78rem', padding: '0.5rem 0' }}
                >
                  Verify Equivalence
                </button>
                {canvasEquivResult && (
                  <div style={{ fontSize: '0.78rem', fontWeight: 'bold', padding: '0.5rem', borderRadius: '4px', background: 'rgba(30,41,59,0.6)', border: '1px solid var(--panel-border)', textAlign: 'center', color: canvasEquivResult.startsWith('Not') ? '#f87171' : '#34d399' }}>
                    {canvasEquivResult}
                  </div>
                )}
              </div>
            </div>
          </aside>

          <section className="visualization-area glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '0.5rem 1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', background: 'rgba(15,23,42,0.4)', borderBottom: '1px solid var(--panel-border)' }}>
              <button
                className={`btn ${editorViewMode === 'graph' ? 'btn-accent' : ''}`}
                onClick={() => setEditorViewMode('graph')}
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
              >
                Graph View
              </button>
              <button
                className={`btn ${editorViewMode === 'table' ? 'btn-accent' : ''}`}
                onClick={() => setEditorViewMode('table')}
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
              >
                Table View
              </button>
            </div>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              {editorViewMode === 'graph' ? (
                <GraphView
                  nodes={graphData.nodes}
                  edges={graphData.edges}
                  onSelectNode={handleSelectNode}
                  onSelectEdge={handleSelectEdge}
                  onDeselect={handleDeselect}
                  activeNodeId={activeSimState}
                  activeEdgeId={activeEdgeIndex}
                />
              ) : (
                <TransitionTable automaton={automaton} activeState={activeSimState} />
              )}
            </div>
          </section>
        </main>
      )}

      {/* RENDER WORKSPACE REPOSITORY TAB */}
      {activeTab === 'WORKSPACE' && (
        <main className="main-content">
          <aside className="controls-sidebar glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Create Regex */}
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
                <Plus size={16} /> Add Regex
              </h3>
              <form onSubmit={handleAddWorkspaceRegex} style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="input-field"
                  value={newRegexInput}
                  onChange={(e) => setNewRegexInput(e.target.value)}
                  placeholder="e.g. (a|b)*"
                  style={{ flex: 1 }}
                />
                <button type="submit" className="btn btn-accent" style={{ padding: '0.5rem' }}>
                  Add
                </button>
              </form>
            </div>

            {/* Error alerts */}
            {workspaceError && (
              <div style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', padding: '0.75rem', borderRadius: '6px', fontSize: '0.825rem' }}>
                {workspaceError}
              </div>
            )}

            {/* List repository items */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
                <LayoutGrid size={16} /> Repository Items
              </h3>

              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingRight: '0.25rem' }}>
                {workspaceItems.map(item => {
                  const isA = item.id === selectedItemAId;
                  const isB = item.id === selectedItemBId;

                  return (
                    <div
                      key={item.id}
                      className="step-item"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        padding: '0.75rem',
                        background: (isA || isB) ? 'rgba(59,130,246,0.15)' : 'rgba(30,41,59,0.3)',
                        borderColor: isA ? '#3b82f6' : (isB ? '#10b981' : 'var(--panel-border)'),
                        borderWidth: '1px',
                        borderStyle: 'solid'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem', wordBreak: 'break-all' }}>{item.label}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.payload.kind.toUpperCase()}</span>
                      </div>

                      {/* Lineage Details */}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <GitCommit size={10} /> Action: {item.createdBy}
                      </div>

                      {/* Transformation Controls */}
                      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                        {item.payload.kind === 'regex' && (
                          <button onClick={() => handleCompileRegex(item.id)} className="btn" style={{ padding: '0.15rem 0.3rem', fontSize: '0.7rem' }}>
                            Compile
                          </button>
                        )}
                        {item.payload.kind === 'automaton' && item.payload.automaton.type === 'ENFA' && (
                          <button onClick={() => handleEliminateEpsilon(item.id)} className="btn" style={{ padding: '0.15rem 0.3rem', fontSize: '0.7rem' }}>
                            No-Eps
                          </button>
                        )}
                        {item.payload.kind === 'automaton' && item.payload.automaton.type === 'NFA' && (
                          <button onClick={() => handleSubsetConstruction(item.id)} className="btn" style={{ padding: '0.15rem 0.3rem', fontSize: '0.7rem' }}>
                            Subset
                          </button>
                        )}
                        {item.payload.kind === 'automaton' && item.payload.automaton.type === 'DFA' && (
                          <button onClick={() => handleMinimize(item.id)} className="btn" style={{ padding: '0.15rem 0.3rem', fontSize: '0.7rem' }}>
                            Minimize
                          </button>
                        )}
                        {item.payload.kind === 'automaton' && item.payload.automaton.type === 'DFA' && (
                          <button
                            onClick={() => handleRelabelWorkspaceItem(item)}
                            className="btn"
                            title="Relabel this DFA as an NFA and edit it on the canvas"
                            style={{ padding: '0.15rem 0.3rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                          >
                            <Shuffle size={11} /> → NFA
                          </button>
                        )}
                        {item.payload.kind === 'automaton' && (
                          <button onClick={() => handleGenerateRegex(item.id)} className="btn" style={{ padding: '0.15rem 0.3rem', fontSize: '0.7rem' }}>
                            Gen-RE
                          </button>
                        )}
                        {item.payload.kind === 'automaton' && (
                          <button onClick={() => handleLoadIntoEditor(item)} className="btn" style={{ padding: '0.15rem 0.3rem', fontSize: '0.7rem', color: 'var(--accent)' }}>
                            Load
                          </button>
                        )}
                      </div>

                      {/* Selection Toggle Buttons */}
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <button
                          onClick={() => setSelectedItemAId(isA ? null : item.id)}
                          className="btn"
                          style={{ flex: 1, padding: '0.2rem', fontSize: '0.7rem', background: isA ? '#3b82f6' : 'transparent', color: isA ? '#fff' : 'var(--text)' }}
                        >
                          {isA ? 'Item A Selected' : 'Select A'}
                        </button>
                        <button
                          onClick={() => setSelectedItemBId(isB ? null : item.id)}
                          className="btn"
                          style={{ flex: 1, padding: '0.2rem', fontSize: '0.7rem', background: isB ? '#10b981' : 'transparent', color: isB ? '#fff' : 'var(--text)' }}
                        >
                          {isB ? 'Item B Selected' : 'Select B'}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {workspaceItems.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: '1rem' }}>
                    Workspace is empty. Add a regex above to begin!
                  </div>
                )}
              </div>
            </div>

            {/* Verification Widget */}
            <div className="steps-panel" style={{ background: 'rgba(30,41,59,0.3)', borderRadius: '8px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)', margin: 0 }}>
                <Check size={16} /> Equivalence Tester
              </h3>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.25rem' }}>
                Item A: <strong>{selectedItemA ? selectedItemA.label : 'None'}</strong><br />
                Item B: <strong>{selectedItemB ? selectedItemB.label : 'None'}</strong>
              </div>
              <button
                onClick={handleVerifyEquivalence}
                className="btn btn-accent"
                disabled={!selectedItemAId || !selectedItemBId}
                style={{ width: '100%', fontSize: '0.8rem', padding: '0.4rem 0' }}
              >
                Verify Equivalence
              </button>
              {equivalenceResult && (
                <div style={{ fontSize: '0.825rem', fontWeight: 'bold', padding: '0.5rem', borderRadius: '4px', background: 'rgba(30,41,59,0.6)', border: '1px solid var(--panel-border)', textAlign: 'center', color: equivalenceResult.startsWith('Not') ? '#f87171' : '#34d399' }}>
                  {equivalenceResult}
                </div>
              )}
            </div>
          </aside>

          {/* Side by side Preview visualization panel */}
          <section className="visualization-area glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: '1rem' }}>
            {/* Header bar with Graph/Table Switcher (only shown if at least one selected item is an automaton) */}
            {((selectedItemA && selectedItemA.payload.kind === 'automaton') ||
              (selectedItemB && selectedItemB.payload.kind === 'automaton')) && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--panel-border)' }}>
                  <button
                    className={`btn ${workspaceViewMode === 'graph' ? 'btn-accent' : ''}`}
                    onClick={() => setWorkspaceViewMode('graph')}
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                  >
                    Graph View
                  </button>
                  <button
                    className={`btn ${workspaceViewMode === 'table' ? 'btn-accent' : ''}`}
                    onClick={() => setWorkspaceViewMode('table')}
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                  >
                    Table View
                  </button>
                </div>
              )}

            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: (selectedItemAId && selectedItemBId) ? '1fr 1fr' : '1fr', gap: '1rem', minHeight: 0 }}>
              {selectedItemAId && (
                <div style={{ background: 'rgba(15,23,42,0.3)', borderRadius: '12px', border: '1px solid var(--panel-border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '0.5rem', background: '#3b82f6', color: '#fff', fontSize: '0.85rem', fontWeight: 'bold', textAlign: 'center' }}>
                    Item A Preview
                  </div>
                  <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                    {renderItemPreview(selectedItemA, workspaceViewMode)}
                  </div>
                </div>
              )}

              {selectedItemBId && (
                <div style={{ background: 'rgba(15,23,42,0.3)', borderRadius: '12px', border: '1px solid var(--panel-border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '0.5rem', background: '#10b981', color: '#fff', fontSize: '0.85rem', fontWeight: 'bold', textAlign: 'center' }}>
                    Item B Preview
                  </div>
                  <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                    {renderItemPreview(selectedItemB, workspaceViewMode)}
                  </div>
                </div>
              )}

              {!selectedItemAId && !selectedItemBId && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', textAlign: 'center' }}>
                  <FileText size={48} style={{ strokeWidth: 1, marginBottom: '1rem' }} />
                  <h3 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem 0', color: 'var(--primary)' }}>Workspace Previewer</h3>
                  <p style={{ margin: 0, fontSize: '0.875rem', maxWidth: '24rem' }}>
                    Select Item A and/or Item B in the repository list to visualize their structures side-by-side and compare language equivalence.
                  </p>
                </div>
              )}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;