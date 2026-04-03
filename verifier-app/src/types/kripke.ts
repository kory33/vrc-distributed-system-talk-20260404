/**
 * Represents a Kripke structure (S, R, V) as JSON-serializable data.
 *
 * - S = {0, 1, ..., nodeCount - 1}
 * - R ⊆ S × S is given by `transitions`
 * - V : AP → P(S) is given by `valuation`
 *
 * Initial states are not modeled as a separate field; instead, they can be
 * encoded via an atomic proposition (e.g. "init") in the valuation.
 *
 * Invariants:
 * - `nodeCount` is a positive integer.
 * - Every index in `transitions` and `valuation` entries is in [0, nodeCount).
 *
 * Note: `transitions` and `valuation` arrays are permitted to contain
 * duplicates. Semantically, duplicates are idempotent (R and V are sets),
 * so consumers must treat these arrays as set representations.
 */
export interface KripkeStructureJson {
  /** The number of states. States are identified by indices 0, ..., nodeCount - 1. */
  readonly nodeCount: number;

  /**
   * Transition relation R ⊆ S × S.
   *
   * Each entry [s, t] denotes an edge from state s to state t.
   * Duplicate pairs are permitted and semantically idempotent.
   */
  readonly transitions: readonly (readonly [number, number])[];

  /**
   * Valuation function V : AP → P(S).
   *
   * Maps each atomic proposition name to the array of state indices
   * where it holds. Duplicate indices are permitted and semantically
   * idempotent.
   */
  readonly valuation: Readonly<Record<string, readonly number[]>>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Returns the `KripkeStructureJson` denoted by `data`, or a human-readable
 * error string if `data` does not represent a valid Kripke structure.
 */
export function parseKripkeStructureJson(
  data: unknown,
): KripkeStructureJson | string {
  if (!isObject(data)) {
    return "Expected a JSON object at the top level.";
  }

  // --- nodeCount ---
  if (typeof data.nodeCount !== "number" || !Number.isInteger(data.nodeCount) || data.nodeCount < 1) {
    return "`nodeCount` must be a positive integer.";
  }
  const nodeCount: number = data.nodeCount;

  const inRange = (i: unknown): i is number =>
    typeof i === "number" && Number.isInteger(i) && i >= 0 && i < nodeCount;

  // --- transitions ---
  if (!Array.isArray(data.transitions)) {
    return "`transitions` must be an array.";
  }
  for (let idx = 0; idx < data.transitions.length; idx++) {
    const entry = data.transitions[idx];
    if (!Array.isArray(entry) || entry.length !== 2 || !inRange(entry[0]) || !inRange(entry[1])) {
      return `transitions[${idx}]: expected a pair [source, target] of state indices in [0, ${nodeCount}).`;
    }
  }
  const transitions = data.transitions as [number, number][];

  // --- valuation ---
  if (!isObject(data.valuation)) {
    return "`valuation` must be an object mapping proposition names to arrays of state indices.";
  }
  const valEntries = Object.entries(data.valuation);
  for (const [prop, indices] of valEntries) {
    if (!Array.isArray(indices)) {
      return `valuation["${prop}"]: expected an array of state indices.`;
    }
    for (let j = 0; j < indices.length; j++) {
      if (!inRange(indices[j])) {
        return `valuation["${prop}"][${j}]: expected a state index in [0, ${nodeCount}).`;
      }
    }
  }
  const valuation = data.valuation as Record<string, number[]>;

  return { nodeCount, transitions, valuation };
}

/**
 * Represents visualization parameters for rendering a Kripke structure.
 *
 * - `colors`: optional mapping from proposition names to CSS color strings.
 *   Keys not present in the structure's valuation are ignored by the renderer.
 *   Color strings are passed directly to the renderer without further validation.
 */
export interface KripkeStructureVisualizationParamsJson {
  readonly colors?: Readonly<Record<string, string>>;
}

/**
 * Represents a Kripke structure together with optional rendering parameters.
 */
export interface KripkeStructureVisualizationJson {
  readonly frame: KripkeStructureJson;
  readonly visualizationParams?: KripkeStructureVisualizationParamsJson;
}

/**
 * Returns the `KripkeStructureVisualizationJson` denoted by `data`, or a
 * human-readable error string if `data` is not a valid visualization payload.
 */
export function parseKripkeStructureVisualizationJson(
  data: unknown,
): KripkeStructureVisualizationJson | string {
  if (!isObject(data)) {
    return "Expected a JSON object at the top level.";
  }

  // --- frame ---
  if (!("frame" in data)) {
    return "Missing `frame` field.";
  }
  const frameResult = parseKripkeStructureJson(data.frame);
  if (typeof frameResult === "string") {
    return `frame: ${frameResult}`;
  }

  // --- visualizationParams (optional) ---
  let visualizationParams: KripkeStructureVisualizationParamsJson | undefined;
  if ("visualizationParams" in data && data.visualizationParams !== undefined) {
    if (!isObject(data.visualizationParams)) {
      return "`visualizationParams` must be an object.";
    }
    const vp = data.visualizationParams;
    if ("colors" in vp && vp.colors !== undefined) {
      if (!isObject(vp.colors)) {
        return "`visualizationParams.colors` must be an object.";
      }
      for (const [key, val] of Object.entries(vp.colors)) {
        if (typeof val !== "string") {
          return `visualizationParams.colors["${key}"]: expected a CSS color string.`;
        }
      }
      visualizationParams = { colors: vp.colors as Record<string, string> };
    } else {
      visualizationParams = {};
    }
  }

  if (visualizationParams === undefined) {
    return { frame: frameResult };
  }
  return { frame: frameResult, visualizationParams };
}
