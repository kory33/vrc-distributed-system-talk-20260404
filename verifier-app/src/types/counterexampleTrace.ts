/**
 * Counterexample traces for CTL model checking.
 *
 * A counterexample is either:
 * - **Finite**: a path through the Kripke structure witnessing a safety
 *   violation (e.g. AG φ fails because some reachable state violates φ).
 * - **Lasso**: an ultimately periodic infinite path witnessing a liveness
 *   violation (e.g. AF φ fails because an infinite path never reaches φ).
 *   Represented as a finite stem followed by a repeating loop.
 */

/** A single step in a counterexample trace. */
export interface TraceStep {
  readonly stateIndex: number;
  /** Maps every atomic proposition in the model to its truth value at this state. */
  readonly valuation: Readonly<Record<string, boolean>>;
}

/** A finite counterexample trace: a path through a Kripke structure. */
export interface FiniteCounterexampleTrace {
  readonly kind: "finite";
  /**
   * A non-empty sequence of states. Each consecutive pair corresponds to
   * a transition in the Kripke structure.
   */
  readonly path: readonly TraceStep[];
}

/**
 * A lasso-shaped counterexample trace representing an ultimately periodic
 * infinite path.
 *
 * Represents the infinite path:
 *   stem[0], ..., stem[k−1], loop[0], ..., loop[m−1], loop[0], ...
 *
 * Invariants:
 * - `loop` is non-empty.
 * - If `stem` is non-empty, there is a transition from `stem[stem.length-1]`
 *   to `loop[0]`.
 * - There is a transition from `loop[loop.length-1]` back to `loop[0]`.
 */
export interface LassoCounterexampleTrace {
  readonly kind: "lasso";
  /** Finite prefix before the loop (may be empty if the start state is on the cycle). */
  readonly stem: readonly TraceStep[];
  /** The repeating cycle (non-empty). */
  readonly loop: readonly TraceStep[];
}

/** A counterexample trace, either finite or lasso-shaped. */
export type CounterexampleTrace =
  | FiniteCounterexampleTrace
  | LassoCounterexampleTrace;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateStepArray(
  data: unknown[],
  fieldName: string,
): TraceStep[] | string {
  for (let i = 0; i < data.length; i++) {
    const step = data[i];
    if (!isObject(step)) {
      return `${fieldName}[${i}]: expected an object.`;
    }
    if (
      typeof step.stateIndex !== "number" ||
      !Number.isInteger(step.stateIndex) ||
      step.stateIndex < 0
    ) {
      return `${fieldName}[${i}].stateIndex: expected a non-negative integer.`;
    }
    if (!isObject(step.valuation)) {
      return `${fieldName}[${i}].valuation: expected an object mapping proposition names to booleans.`;
    }
    for (const [prop, val] of Object.entries(step.valuation)) {
      if (typeof val !== "boolean") {
        return `${fieldName}[${i}].valuation["${prop}"]: expected a boolean.`;
      }
    }
  }
  return data as TraceStep[];
}

/**
 * Returns the `CounterexampleTrace` denoted by `data`, or a
 * human-readable error string if `data` is not valid.
 *
 * Accepts three JSON shapes:
 * - `{ kind: "finite", path: [...] }` — finite trace
 * - `{ kind: "lasso", stem: [...], loop: [...] }` — lasso trace
 * - `{ path: [...] }` (no `kind`) — treated as finite (backward compatibility)
 */
export function parseCounterexampleTrace(
  data: unknown,
): CounterexampleTrace | string {
  if (!isObject(data)) {
    return "Expected a JSON object at the top level.";
  }

  const kind = data.kind;

  if (kind === "lasso") {
    // --- Lasso trace ---
    if (!Array.isArray(data.stem)) {
      return "`stem` must be an array.";
    }
    const stemResult = validateStepArray(data.stem, "stem");
    if (typeof stemResult === "string") return stemResult;

    if (!Array.isArray(data.loop)) {
      return "`loop` must be an array.";
    }
    if (data.loop.length === 0) {
      return "`loop` must be non-empty.";
    }
    const loopResult = validateStepArray(data.loop, "loop");
    if (typeof loopResult === "string") return loopResult;

    return { kind: "lasso", stem: stemResult, loop: loopResult };
  }

  // --- Finite trace (explicit kind or backward-compatible) ---
  if (kind !== undefined && kind !== "finite") {
    return `Unknown trace kind: "${String(kind)}". Expected "finite" or "lasso".`;
  }

  if (!Array.isArray(data.path)) {
    return "`path` must be an array.";
  }
  if (data.path.length === 0) {
    return "`path` must be non-empty.";
  }
  const pathResult = validateStepArray(data.path, "path");
  if (typeof pathResult === "string") return pathResult;

  return { kind: "finite", path: pathResult };
}
