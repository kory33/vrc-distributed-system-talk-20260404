/**
 * CTL model checker over Kripke structures.
 *
 * Given a `KripkeStructureJson` and a `CTLFormula`, computes the
 * **satisfaction set** for every subformula: the set of states where
 * that subformula holds.
 *
 * The algorithm follows the standard fixpoint characterization of CTL:
 *   EF φ   = μZ. φ ∨ EX Z
 *   AF φ   = μZ. φ ∨ AX Z
 *   EG φ   = νZ. φ ∧ EX Z
 *   AG φ   = νZ. φ ∧ AX Z
 *   E[φ U ψ] = μZ. ψ ∨ (φ ∧ EX Z)
 *   A[φ U ψ] = μZ. ψ ∨ (φ ∧ AX Z)
 */

import type { KripkeStructureJson } from "./kripke";
import type { CTLFormula } from "./ctl";
import { allSubformulae } from "./ctl";

// ---------------------------------------------------------------------------
// Precomputed transition structure
// ---------------------------------------------------------------------------

/**
 * Represents the transition relation of a Kripke structure in both
 * forward (successors) and backward (predecessors) adjacency-list form.
 */
interface TransitionIndex {
  /** successors[s] = set of states reachable from s. */
  readonly successors: ReadonlyArray<ReadonlySet<number>>;
  /** predecessors[t] = set of states that have an edge to t. */
  readonly predecessors: ReadonlyArray<ReadonlySet<number>>;
}

function buildTransitionIndex(ks: KripkeStructureJson): TransitionIndex {
  const successors: Set<number>[] = Array.from({ length: ks.nodeCount }, () => new Set());
  const predecessors: Set<number>[] = Array.from({ length: ks.nodeCount }, () => new Set());
  for (const [s, t] of ks.transitions) {
    successors[s].add(t);
    predecessors[t].add(s);
  }
  return { successors, predecessors };
}

// ---------------------------------------------------------------------------
// Set helpers
// ---------------------------------------------------------------------------

function allStates(n: number): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < n; i++) s.add(i);
  return s;
}

function union(a: ReadonlySet<number>, b: ReadonlySet<number>): Set<number> {
  const r = new Set(a);
  for (const x of b) r.add(x);
  return r;
}

function intersect(a: ReadonlySet<number>, b: ReadonlySet<number>): Set<number> {
  const r = new Set<number>();
  for (const x of a) {
    if (b.has(x)) r.add(x);
  }
  return r;
}

function complement(all: number, a: ReadonlySet<number>): Set<number> {
  const r = new Set<number>();
  for (let i = 0; i < all; i++) {
    if (!a.has(i)) r.add(i);
  }
  return r;
}

function setsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Core operators: EX and AX
// ---------------------------------------------------------------------------

/** EX φ: states that have at least one successor in `sat`. */
function computeEX(sat: ReadonlySet<number>, idx: TransitionIndex): Set<number> {
  const result = new Set<number>();
  for (const t of sat) {
    for (const s of idx.predecessors[t]) {
      result.add(s);
    }
  }
  return result;
}

/** AX φ: states where all successors are in `sat`. States with no successors vacuously satisfy AX. */
function computeAX(sat: ReadonlySet<number>, idx: TransitionIndex, n: number): Set<number> {
  const result = new Set<number>();
  for (let s = 0; s < n; s++) {
    const succs = idx.successors[s];
    if (succs.size === 0) {
      // No successors: AX holds vacuously
      result.add(s);
      continue;
    }
    let allIn = true;
    for (const t of succs) {
      if (!sat.has(t)) { allIn = false; break; }
    }
    if (allIn) result.add(s);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fixpoint computation
// ---------------------------------------------------------------------------

/** Least fixpoint: iterates f starting from the empty set until stable. */
function lfp(n: number, f: (z: ReadonlySet<number>) => Set<number>): Set<number> {
  let z: Set<number> = new Set();
  for (;;) {
    const next = f(z);
    if (setsEqual(z, next)) return z;
    z = next;
  }
}

/** Greatest fixpoint: iterates f starting from the set of all states until stable. */
function gfp(n: number, f: (z: ReadonlySet<number>) => Set<number>): Set<number> {
  let z = allStates(n);
  for (;;) {
    const next = f(z);
    if (setsEqual(z, next)) return z;
    z = next;
  }
}

// ---------------------------------------------------------------------------
// Model checker
// ---------------------------------------------------------------------------

/**
 * Returns a Map from each subformula (by reference identity) of `formula`
 * to the set of states in `ks` that satisfy it.
 *
 * The map includes entries for `formula` itself and all of its subformulae.
 */
export function checkCTL(
  ks: KripkeStructureJson,
  formula: CTLFormula,
): Map<CTLFormula, ReadonlySet<number>> {
  const idx = buildTransitionIndex(ks);
  const n = ks.nodeCount;
  const result = new Map<CTLFormula, ReadonlySet<number>>();

  // Build valuation index: prop name -> set of states
  const valIndex = new Map<string, ReadonlySet<number>>();
  for (const [prop, indices] of Object.entries(ks.valuation)) {
    valIndex.set(prop, new Set(indices));
  }

  function eval_(f: CTLFormula): ReadonlySet<number> {
    if (result.has(f)) return result.get(f)!;

    let sat: ReadonlySet<number>;

    switch (f.tag) {
      case "true":
        sat = allStates(n);
        break;
      case "false":
        sat = new Set();
        break;
      case "atom":
        sat = valIndex.get(f.name) ?? new Set();
        break;
      case "not":
        sat = complement(n, eval_(f.sub));
        break;
      case "and":
        sat = intersect(eval_(f.left), eval_(f.right));
        break;
      case "or":
        sat = union(eval_(f.left), eval_(f.right));
        break;
      case "implies":
        sat = union(complement(n, eval_(f.left)), eval_(f.right));
        break;
      case "EX":
        sat = computeEX(eval_(f.sub), idx);
        break;
      case "AX":
        sat = computeAX(eval_(f.sub), idx, n);
        break;
      case "EF":
        { const satPhi = eval_(f.sub);
          sat = lfp(n, (z) => union(satPhi, computeEX(z, idx)));
        }
        break;
      case "AF":
        { const satPhi = eval_(f.sub);
          sat = lfp(n, (z) => union(satPhi, computeAX(z, idx, n)));
        }
        break;
      case "EG":
        { const satPhi = eval_(f.sub);
          sat = gfp(n, (z) => intersect(satPhi, computeEX(z, idx)));
        }
        break;
      case "AG":
        { const satPhi = eval_(f.sub);
          sat = gfp(n, (z) => intersect(satPhi, computeAX(z, idx, n)));
        }
        break;
      case "EU":
        { const satLeft = eval_(f.left);
          const satRight = eval_(f.right);
          sat = lfp(n, (z) => union(satRight, intersect(satLeft, computeEX(z, idx))));
        }
        break;
      case "AU":
        { const satLeft = eval_(f.left);
          const satRight = eval_(f.right);
          sat = lfp(n, (z) => union(satRight, intersect(satLeft, computeAX(z, idx, n))));
        }
        break;
    }

    result.set(f, sat);
    return sat;
  }

  // Evaluate bottom-up by visiting all subformulae
  for (const sub of allSubformulae(formula)) {
    eval_(sub);
  }

  return result;
}
