// Deterministic alphabet -> color mapping.
//
// The goal: whichever symbol fires ('a', 'b', '0', 'x', ...) should render as
// the *same* color everywhere it shows up -- Graph View edge labels, the
// Transition Table's column headers/cells, and the simulator's active-symbol
// trace. That turns color into information (which symbol just fired) instead
// of decoration.
//
// It's a pure function of the symbol string, so every component can call it
// independently and stay in sync without passing a shared lookup table around.

import { EPSILON } from './types.ts';

// Six hues chosen to sit comfortably against the dark instrument-panel
// background and stay distinct from the UI's own semantic colors
// (--primary blue = start state, --success green = accept state,
// --danger red = errors/delete). None of these six overlap those roles.
const SYMBOL_PALETTE = [
  '#f2b134', // amber
  '#e0577c', // rose
  '#4fd1c5', // teal
  '#c084fc', // violet
  '#84cc16', // lime
  '#38bdf8', // sky
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Solid color for a transition symbol. Epsilon is intentionally neutral --
 * it's a structural transition, not an input symbol, so it shouldn't
 * compete with the alphabet's colors. */
export function getSymbolColor(symbol: string): string {
  if (symbol === EPSILON || symbol === '' || symbol == null) {
    return '#64748b'; // matches the previous neutral edge color
  }
  return SYMBOL_PALETTE[hashString(symbol) % SYMBOL_PALETTE.length];
}

/** Same color, ~15% alpha -- for cell/column tint fills where a solid hue
 * would be too loud against table rows. */
export function getSymbolColorDim(symbol: string): string {
  const hex = getSymbolColor(symbol);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.14)`;
}