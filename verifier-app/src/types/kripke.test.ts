import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  type KripkeStructureJson,
  parseKripkeStructureJson,
  parseKripkeStructureVisualizationJson,
} from "./kripke";

describe("parseKripkeStructureJson", () => {
  it("accepts a valid minimal Kripke structure", () => {
    const result = parseKripkeStructureJson({
      nodeCount: 1,
      transitions: [[0, 0]],
      valuation: {},
    });
    expect(typeof result).not.toBe("string");
  });

  it("rejects non-object input", () => {
    expect(typeof parseKripkeStructureJson(42)).toBe("string");
    expect(typeof parseKripkeStructureJson(null)).toBe("string");
    expect(typeof parseKripkeStructureJson([1])).toBe("string");
  });

  it("rejects nodeCount < 1", () => {
    expect(
      typeof parseKripkeStructureJson({
        nodeCount: 0,
        transitions: [],
        valuation: {},
      }),
    ).toBe("string");
  });

  it("rejects out-of-range transition indices", () => {
    const result = parseKripkeStructureJson({
      nodeCount: 2,
      transitions: [[0, 2]],
      valuation: {},
    });
    expect(typeof result).toBe("string");
  });

  it("rejects out-of-range valuation indices", () => {
    const result = parseKripkeStructureJson({
      nodeCount: 2,
      transitions: [[0, 1], [1, 0]],
      valuation: { p: [0, 3] },
    });
    expect(typeof result).toBe("string");
  });

  it("rejects sink states (states with no successors)", () => {
    const result = parseKripkeStructureJson({
      nodeCount: 2,
      transitions: [[0, 1]],
      valuation: {},
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("sink state");
  });

  // PBT: parseKripkeStructureJson is a left inverse of the identity on
  // well-formed KripkeStructureJson values (with total transition relations)
  it("returns the input value for any well-formed Kripke structure (PBT)", () => {
    const arbKripke = arbTotalKripke(20);

    fc.assert(
      fc.property(arbKripke, (ks) => {
        const result = parseKripkeStructureJson(ks);
        expect(result).toEqual(ks);
      }),
    );
  });

  // PBT: any transition index outside [0, nodeCount) is rejected
  it("rejects any out-of-range transition index (PBT)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.oneof(fc.integer({ max: -1 }), fc.integer({ min: 10 })),
        (nodeCount, badIdx) => {
          fc.pre(badIdx < 0 || badIdx >= nodeCount);
          // Include self-loops for all states to satisfy totality,
          // plus the bad transition
          const transitions: [number, number][] = Array.from(
            { length: nodeCount },
            (_, i) => [i, i] as [number, number],
          );
          transitions.push([0, badIdx]);
          const result = parseKripkeStructureJson({
            nodeCount,
            transitions,
            valuation: {},
          });
          expect(typeof result).toBe("string");
        },
      ),
    );
  });
});

describe("parseKripkeStructureVisualizationJson", () => {
  it("accepts a valid structure with visualization params", () => {
    const result = parseKripkeStructureVisualizationJson({
      kripkeStructure: { nodeCount: 2, transitions: [[0, 1], [1, 0]], valuation: { p: [0] } },
      visualizationParams: { colors: { p: "#ff0000" } },
    });
    expect(typeof result).not.toBe("string");
  });

  it("accepts without visualizationParams", () => {
    const result = parseKripkeStructureVisualizationJson({
      kripkeStructure: { nodeCount: 1, transitions: [[0, 0]], valuation: {} },
    });
    expect(typeof result).not.toBe("string");
  });

  it("rejects invalid kripkeStructure", () => {
    const result = parseKripkeStructureVisualizationJson({
      kripkeStructure: { nodeCount: 0, transitions: [], valuation: {} },
    });
    expect(typeof result).toBe("string");
  });

  it("rejects non-string color values", () => {
    const result = parseKripkeStructureVisualizationJson({
      kripkeStructure: { nodeCount: 1, transitions: [[0, 0]], valuation: { p: [0] } },
      visualizationParams: { colors: { p: 123 } },
    });
    expect(typeof result).toBe("string");
  });

  // PBT: parseKripkeStructureVisualizationJson is a left inverse of the
  // identity on well-formed KripkeStructureVisualizationJson values
  it("returns the input value for any well-formed visualization JSON (PBT)", () => {
    const arbColor = fc.stringMatching(/^#[0-9a-f]{6}$/);
    const arbViz = fc
      .integer({ min: 1, max: 20 })
      .chain((nodeCount) => {
        const arbIndex = fc.integer({ min: 0, max: nodeCount - 1 });
        const arbPropName = fc.stringMatching(/^[a-z]{1,5}$/);
        const arbFrame = arbTotalKripkeOfSize(nodeCount, arbPropName, arbIndex);
        // Generate either { kripkeStructure } or { kripkeStructure, visualizationParams }
        // to test that omitted keys stay omitted
        return fc.oneof(
          arbFrame.map((kripkeStructure) => ({ kripkeStructure })),
          fc.record({
            kripkeStructure: arbFrame,
            visualizationParams: fc.record({
              colors: fc.dictionary(arbPropName, arbColor),
            }),
          }),
        );
      });

    fc.assert(
      fc.property(arbViz, (v) => {
        expect(parseKripkeStructureVisualizationJson(v)).toEqual(v);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

/**
 * Generates a KripkeStructureJson with a total transition relation
 * (every state has at least one successor).
 */
function arbTotalKripke(maxNodes: number): fc.Arbitrary<KripkeStructureJson> {
  return fc.integer({ min: 1, max: maxNodes }).chain((nodeCount) => {
    const arbIndex = fc.integer({ min: 0, max: nodeCount - 1 });
    const arbPropName = fc.stringMatching(/^[a-z]{1,5}$/);
    return arbTotalKripkeOfSize(nodeCount, arbPropName, arbIndex);
  });
}

function arbTotalKripkeOfSize(
  nodeCount: number,
  arbPropName: fc.Arbitrary<string>,
  arbIndex: fc.Arbitrary<number>,
): fc.Arbitrary<KripkeStructureJson> {
  // Generate one mandatory successor per state (ensures totality),
  // plus additional random transitions.
  const arbMandatory = fc.tuple(
    ...Array.from({ length: nodeCount }, () => arbIndex),
  );
  return fc
    .record({
      mandatory: arbMandatory,
      extra: fc.array(fc.tuple(arbIndex, arbIndex)),
      valuation: fc.dictionary(arbPropName, fc.array(arbIndex)),
    })
    .map(({ mandatory, extra, valuation }) => ({
      nodeCount,
      transitions: [
        ...mandatory.map((target, src) => [src, target] as [number, number]),
        ...extra,
      ],
      valuation,
    }));
}
