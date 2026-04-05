/**
 * Counterexample generation for the universal fragment of CTL.
 *
 * Supports two trace shapes:
 * - **Finite** (AG, AX): a path to a state where a safety property fails.
 * - **Lasso** (AF, AU): an ultimately periodic infinite path witnessing a
 *   liveness violation.
 *
 * Combinators (implies, and) recurse into the appropriate sub-trace.
 */

import type { CTLFormula } from "./ctl";
import type { KripkeStructureJson } from "./kripke";
import type {
  CounterexampleTrace,
  LassoCounterexampleTrace,
  TraceStep,
} from "./counterexampleTrace";

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

/**
 * Returns true when `generateCounterexampleTrace` can produce a trace for `f`.
 *
 * Supported top-level shapes: AG, AX, AF, AU, and combinations through
 * implies/and.
 */
export function isTraceSupported(f: CTLFormula): boolean {
  switch (f.tag) {
    case "AG":
    case "AX":
    case "AF":
    case "AU":
      return true;
    case "implies":
      return isTraceSupported(f.right);
    case "and":
      return isTraceSupported(f.left) && isTraceSupported(f.right);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
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

function stateToStep(ks: KripkeStructureJson, s: number): TraceStep {
  return { stateIndex: s, valuation: valuationAt(ks, s) };
}

/**
 * Builds forward adjacency lists from the raw transition relation.
 *
 * Precondition: `ks` has no sink states (the parser rejects them),
 * so every state has at least one successor.
 */
function buildSuccessors(ks: KripkeStructureJson): Set<number>[] {
  const succ: Set<number>[] = Array.from(
    { length: ks.nodeCount },
    () => new Set(),
  );
  for (const [s, t] of ks.transitions) {
    succ[s].add(t);
  }
  return succ;
}

/**
 * BFS from `start` over the transition relation of `ks`, returning
 * the shortest path to any state in `targets`, or null if unreachable.
 */
function bfsShortestPath(
  succ: ReadonlyArray<ReadonlySet<number>>,
  start: number,
  targets: ReadonlySet<number>,
): number[] | null {
  if (targets.has(start)) return [start];

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
 * BFS from `start`, restricted to states in `within`, returning the
 * shortest path to any state in `targets`, or null if unreachable.
 */
function bfsShortestPathWithin(
  succ: ReadonlyArray<ReadonlySet<number>>,
  start: number,
  within: ReadonlySet<number>,
  targets: ReadonlySet<number>,
): number[] | null {
  if (targets.has(start)) return [start];

  const visited = new Set<number>([start]);
  const parent = new Map<number, number>();
  const queue = [start];

  for (let qi = 0; qi < queue.length; qi++) {
    const s = queue[qi];
    for (const t of succ[s]) {
      if (!within.has(t) || visited.has(t)) continue;
      visited.add(t);
      parent.set(t, s);
      if (targets.has(t)) {
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
 * Returns a lasso trace by walking from `startState` through states in
 * `within` until a state is revisited.
 *
 * Precondition: every state in `within` has at least one successor in
 * `within` (guaranteed by the fixpoint characterization of AF/AU bad sets
 * combined with the totality of the transition relation). This ensures
 * termination via the pigeonhole principle.
 */
function findLasso(
  ks: KripkeStructureJson,
  succ: ReadonlyArray<ReadonlySet<number>>,
  within: ReadonlySet<number>,
  startState: number,
): LassoCounterexampleTrace {
  const path: number[] = [startState];
  const visited = new Map<number, number>([[startState, 0]]);
  let current = startState;

  for (;;) {
    // Find first successor within the restricted set
    let next = -1;
    for (const t of succ[current]) {
      if (within.has(t)) {
        next = t;
        break;
      }
    }
    // Precondition guarantees a successor exists
    if (next === -1) {
      throw new Error(
        `findLasso: state ${current} has no successor in the restricted set (this should be unreachable)`,
      );
    }

    const loopEntry = visited.get(next);
    if (loopEntry !== undefined) {
      // Found the lasso
      const stemStates = path.slice(0, loopEntry);
      const loopStates = path.slice(loopEntry);
      return {
        kind: "lasso",
        stem: stemStates.map((s) => stateToStep(ks, s)),
        loop: loopStates.map((s) => stateToStep(ks, s)),
      };
    }

    visited.set(next, path.length);
    path.push(next);
    current = next;
  }
}

// ---------------------------------------------------------------------------
// Counterexample trace generation
// ---------------------------------------------------------------------------

/**
 * Returns the set of state indices in [0, n) that are NOT in `sat`.
 */
function complementSet(
  n: number,
  sat: ReadonlySet<number>,
): Set<number> {
  const result = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (!sat.has(i)) result.add(i);
  }
  return result;
}

/**
 * Attempts to generate a counterexample trace for `formula` at `startState`.
 * Returns null if the formula shape is not supported or no counterexample exists.
 *
 * Supported shapes:
 * - `AG φ`: finite — BFS shortest path to a ¬φ state
 * - `AX φ`: finite — one-step path to a successor where φ fails
 * - `AF φ`: lasso — infinite path where φ never holds
 * - `AU(φ,ψ)`: finite path to a state where φ fails (before ψ holds),
 *   or lasso where ψ never holds
 * - `implies(L, R)`: recurse on R when L holds at startState
 * - `and(L, R)`: recurse on whichever child fails
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

  const succ = buildSuccessors(ks);
  const n = ks.nodeCount;

  const pathToTrace = (path: number[]): CounterexampleTrace => ({
    kind: "finite",
    path: path.map((s) => stateToStep(ks, s)),
  });

  switch (formula.tag) {
    case "AG": {
      const subSat = satMap.get(formula.sub);
      if (!subSat) return null;
      const targets = complementSet(n, subSat);
      const path = bfsShortestPath(succ, startState, targets);
      return path ? pathToTrace(path) : null;
    }

    case "AX": {
      const subSat = satMap.get(formula.sub);
      if (!subSat) return null;
      for (const t of succ[startState]) {
        if (!subSat.has(t)) {
          return pathToTrace([startState, t]);
        }
      }
      return null;
    }

    case "AF": {
      // bad = states where AF φ fails.  By ¬AF φ = EG ¬φ, every state
      // in bad has φ false and a successor in bad.
      if (!sat) return null;
      const bad = complementSet(n, sat);
      return findLasso(ks, succ, bad, startState);
    }

    case "AU": {
      // bad = states where AU(φ,ψ) fails.  Every state in bad has ψ false.
      // A state in bad with φ also false is a "terminal" — the finite
      // counterexample endpoint.  Non-terminal states (φ true, ψ false)
      // have a successor in bad.
      if (!sat) return null;
      const bad = complementSet(n, sat);
      const phiSat = satMap.get(formula.left);
      const terminal = new Set<number>();
      for (const s of bad) {
        if (!phiSat || !phiSat.has(s)) terminal.add(s);
      }
      // Prefer finite traces (simpler for users)
      if (terminal.size > 0) {
        const path = bfsShortestPathWithin(succ, startState, bad, terminal);
        if (path) return pathToTrace(path);
      }
      // No terminal reachable — find lasso (ψ never holds, φ always holds)
      return findLasso(ks, succ, bad, startState);
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
