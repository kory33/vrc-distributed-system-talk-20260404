/**
 * A counterexample trace: a finite path through a Kripke structure
 * witnessing the violation of a CTL formula.
 *
 * Each consecutive pair `(path[i], path[i+1])` corresponds to a
 * transition in the Kripke structure.
 */

/** A single step in a counterexample trace. */
export interface TraceStep {
  readonly stateIndex: number;
  /** Maps every atomic proposition in the model to its truth value at this state. */
  readonly valuation: Readonly<Record<string, boolean>>;
}

/** A counterexample trace: a finite path through a Kripke structure. */
export interface CounterexampleTrace {
  readonly path: readonly TraceStep[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Returns the `CounterexampleTrace` denoted by `data`, or a
 * human-readable error string if `data` is not valid.
 */
export function parseCounterexampleTrace(
  data: unknown,
): CounterexampleTrace | string {
  if (!isObject(data)) {
    return "Expected a JSON object at the top level.";
  }

  if (!Array.isArray(data.path)) {
    return "`path` must be an array.";
  }

  if (data.path.length === 0) {
    return "`path` must be non-empty.";
  }

  for (let i = 0; i < data.path.length; i++) {
    const step = data.path[i];
    if (!isObject(step)) {
      return `path[${i}]: expected an object.`;
    }
    if (typeof step.stateIndex !== "number" || !Number.isInteger(step.stateIndex) || step.stateIndex < 0) {
      return `path[${i}].stateIndex: expected a non-negative integer.`;
    }
    if (!isObject(step.valuation)) {
      return `path[${i}].valuation: expected an object mapping proposition names to booleans.`;
    }
    for (const [prop, val] of Object.entries(step.valuation)) {
      if (typeof val !== "boolean") {
        return `path[${i}].valuation["${prop}"]: expected a boolean.`;
      }
    }
  }

  return { path: data.path as TraceStep[] };
}
