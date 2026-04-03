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
      transitions: [],
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
      transitions: [],
      valuation: { p: [0, 3] },
    });
    expect(typeof result).toBe("string");
  });

  // PBT: parseKripkeStructureJson is a left inverse of the identity on
  // well-formed KripkeStructureJson values
  it("returns the input value for any well-formed Kripke structure (PBT)", () => {
    const arbKripke = fc
      .integer({ min: 1, max: 20 })
      .chain((nodeCount) => {
        const arbIndex = fc.integer({ min: 0, max: nodeCount - 1 });
        return fc.record({
          nodeCount: fc.constant(nodeCount),
          transitions: fc.array(fc.tuple(arbIndex, arbIndex)),
          valuation: fc.dictionary(
            fc.stringMatching(/^[a-z]{1,5}$/),
            fc.array(arbIndex),
          ),
        });
      });

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
          const result = parseKripkeStructureJson({
            nodeCount,
            transitions: [[0, badIdx]],
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
      frame: { nodeCount: 2, transitions: [[0, 1]], valuation: { p: [0] } },
      visualizationParams: { colors: { p: "#ff0000" } },
    });
    expect(typeof result).not.toBe("string");
  });

  it("accepts without visualizationParams", () => {
    const result = parseKripkeStructureVisualizationJson({
      frame: { nodeCount: 1, transitions: [], valuation: {} },
    });
    expect(typeof result).not.toBe("string");
  });

  it("rejects invalid frame", () => {
    const result = parseKripkeStructureVisualizationJson({
      frame: { nodeCount: 0, transitions: [], valuation: {} },
    });
    expect(typeof result).toBe("string");
  });

  it("rejects non-string color values", () => {
    const result = parseKripkeStructureVisualizationJson({
      frame: { nodeCount: 1, transitions: [], valuation: { p: [0] } },
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
        const arbFrame = fc.record({
          nodeCount: fc.constant(nodeCount),
          transitions: fc.array(fc.tuple(arbIndex, arbIndex)),
          valuation: fc.dictionary(arbPropName, fc.array(arbIndex)),
        });
        // Generate either { frame } or { frame, visualizationParams }
        // to test that omitted keys stay omitted
        return fc.oneof(
          arbFrame.map((frame) => ({ frame })),
          fc.record({
            frame: arbFrame,
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
