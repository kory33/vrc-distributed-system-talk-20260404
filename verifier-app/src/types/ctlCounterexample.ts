/**
 * Counterexample generation for the universal fragment of CTL.
 *
 * A CTL formula is in the **universal fragment** when every path
 * quantifier is ∀ (A), not ∃ (E). For such formulas, a counterexample
 * to AG φ at state s is a finite path from s to a state where φ fails.
 */

import type { CTLFormula } from "./ctl";
import type { KripkeStructureJson } from "./kripke";
import type { CounterexampleTrace } from "./counterexampleTrace";

// ---------------------------------------------------------------------------
// Universal fragment check
// ---------------------------------------------------------------------------

/**
 * Returns true when `f` contains no existential path quantifiers
 * (EX, EF, EG, EU), i.e. `f` is in the universal fragment of CTL.
 */
export function isInUniversalFragment(f: CTLFormula): boolean {
  switch (f.tag) {
    case "true":
    case "false":
    case "atom":
      return true;
    case "not":
      return isInUniversalFragment(f.sub);
    case "and":
    case "or":
    case "implies":
      return isInUniversalFragment(f.left) && isInUniversalFragment(f.right);
    case "AX":
    case "AF":
    case "AG":
      return isInUniversalFragment(f.sub);
    case "AU":
      return isInUniversalFragment(f.left) && isInUniversalFragment(f.right);
    case "EX":
    case "EF":
    case "EG":
    case "EU":
      return false;
  }
}

// ---------------------------------------------------------------------------
// Counterexample path generation
// ---------------------------------------------------------------------------

/**
 * Returns a valuation record mapping every proposition in `ks`
 * to its truth value at `stateIndex`.
 */
function valuationAt(
  ks: KripkeStructureJson,
  stateIndex: number,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [prop, indices] of Object.entries(ks.valuation)) {
    result[prop] = indices.includes(stateIndex);
  }
  return result;
}

/**
 * BFS from `start` over the transition relation of `ks`, returning
 * the shortest path to any state in `targets`, or null if unreachable.
 */
function bfsShortestPath(
  ks: KripkeStructureJson,
  start: number,
  targets: ReadonlySet<number>,
): number[] | null {
  if (targets.has(start)) return [start];

  // Build forward adjacency
  const succ: Set<number>[] = Array.from({ length: ks.nodeCount }, () => new Set());
  for (const [s, t] of ks.transitions) {
    succ[s].add(t);
  }

  const visited = new Set<number>([start]);
  const parent = new Map<number, number>();
  const queue = [start];

  for (let qi = 0; qi < queue.length; qi++) {
    const s = queue[qi];
    for (const t of succ[s]) {
      if (visited.has(t)) continue;
      visited.add(t);
      parent.set(t, s);
      if (targets.has(t)) {
        // Reconstruct path
        const path: number[] = [t];
        let cur = t;
        while (parent.has(cur)) {
          cur = parent.get(cur)!;
          path.push(cur);
        }
        path.reverse();
        return path;
      }
      queue.push(t);
    }
  }
  return null;
}

/**
 * Attempts to generate a finite counterexample trace for `formula`
 * at `startState`. Returns null if the formula shape is not supported
 * (e.g. AF/AU require lasso traces) or no counterexample exists.
 *
 * Supported shapes:
 * - `AG φ`: BFS shortest path to a ¬φ state
 * - `AX φ`: one-step path to a successor where φ fails
 * - `implies(L, R)` where L holds at startState: recurse on R
 * - `and(L, R)`: recurse on whichever child fails
 * - Boolean wrappers around the above
 */
export function generateCounterexampleTrace(
  ks: KripkeStructureJson,
  satMap: ReadonlyMap<CTLFormula, ReadonlySet<number>>,
  formula: CTLFormula,
  startState: number,
): CounterexampleTrace | null {
  const sat = satMap.get(formula);
  // If the formula is actually satisfied at startState, no counterexample
  if (sat && sat.has(startState)) return null;

  const pathToTrace = (path: number[]): CounterexampleTrace => ({
    path: path.map((s) => ({
      stateIndex: s,
      valuation: valuationAt(ks, s),
    })),
  });

  switch (formula.tag) {
    case "AG": {
      const subSat = satMap.get(formula.sub);
      if (!subSat) return null;
      // Find states where sub is false
      const targets = new Set<number>();
      for (let i = 0; i < ks.nodeCount; i++) {
        if (!subSat.has(i)) targets.add(i);
      }
      const path = bfsShortestPath(ks, startState, targets);
      return path ? pathToTrace(path) : null;
    }

    case "AX": {
      const subSat = satMap.get(formula.sub);
      if (!subSat) return null;
      // Build forward adjacency for startState
      for (const [s, t] of ks.transitions) {
        if (s === startState && !subSat.has(t)) {
          return pathToTrace([startState, t]);
        }
      }
      return null;
    }

    case "implies": {
      const leftSat = satMap.get(formula.left);
      // implies is false when left is true and right is false
      if (leftSat && leftSat.has(startState)) {
        return generateCounterexampleTrace(ks, satMap, formula.right, startState);
      }
      return null;
    }

    case "and": {
      const leftSat = satMap.get(formula.left);
      // Try whichever child fails
      if (!leftSat || !leftSat.has(startState)) {
        return generateCounterexampleTrace(ks, satMap, formula.left, startState);
      }
      return generateCounterexampleTrace(ks, satMap, formula.right, startState);
    }

    default:
      return null;
  }
}
