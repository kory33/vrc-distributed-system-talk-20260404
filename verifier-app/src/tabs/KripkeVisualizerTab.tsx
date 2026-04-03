import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type cytoscape from "cytoscape";
import {
  type KripkeStructureJson,
  type KripkeStructureVisualizationJson,
  parseKripkeStructureVisualizationJson,
} from "../types/kripke";

// ---------------------------------------------------------------------------
// Color assignment
// ---------------------------------------------------------------------------

/**
 * Returns an HSL color string whose hue is determined by the golden angle,
 * producing a sequence of visually distinguishable colors.
 */
function autoColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

/** A proposition name together with its display color. */
export interface PropositionColoring {
  readonly name: string;
  readonly color: string;
}

/**
 * Returns the ordered list of proposition colorings for all propositions
 * present in `viz.frame.valuation`, preserving their insertion order.
 *
 * Propositions with an explicit color in `viz.visualizationParams.colors`
 * use that color; others are assigned via golden-angle HSL palette.
 */
function resolvePropositionColors(
  viz: KripkeStructureVisualizationJson,
): PropositionColoring[] {
  const explicitColors = viz.visualizationParams?.colors ?? {};
  let autoIndex = 0;
  return Object.keys(viz.frame.valuation).map((name) => ({
    name,
    color: explicitColors[name] ?? autoColor(autoIndex++),
  }));
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_JSON: KripkeStructureVisualizationJson = {
  frame: {
    nodeCount: 3,
    transitions: [
      [0, 1],
      [1, 2],
      [2, 0],
      [1, 1],
    ],
    valuation: {
      init: [0],
      busy: [1, 2],
    },
  },
  visualizationParams: {
    colors: { init: "#4caf50", busy: "#ff9800" },
  },
};

// ---------------------------------------------------------------------------
// Cytoscape helpers
// ---------------------------------------------------------------------------

const LAYOUT: cytoscape.LayoutOptions = {
  name: "cose",
  animate: false,
};

const INACTIVE_COLOR = "#616161";
const FALSE_SECTOR_COLOR = "#2e2e2e";

/**
 * Returns Cytoscape element definitions for the given Kripke structure.
 *
 * Each node carries a `stateIndex` data field (the numeric state id)
 * so that downstream consumers (tooltip, styling) can derive per-node
 * information directly from the frame rather than through serialized data.
 */
function kripkeToElements(
  frame: KripkeStructureJson,
): cytoscape.ElementDefinition[] {
  const nodes: cytoscape.ElementDefinition[] = Array.from(
    { length: frame.nodeCount },
    (_, i) => ({
      data: {
        id: String(i),
        label: String(i),
        stateIndex: i,
      },
    }),
  );

  // Deduplicate transitions (arrays are set representations per contract)
  const seenEdges = new Set<string>();
  const edges: cytoscape.ElementDefinition[] = [];
  for (const [s, t] of frame.transitions) {
    const key = `${s}->${t}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({
      data: { id: key, source: String(s), target: String(t) },
    });
  }

  return [...nodes, ...edges];
}

/**
 * Returns the set of proposition names that hold at `stateIndex`
 * according to `frame.valuation`.
 */
function propositionsAt(
  frame: KripkeStructureJson,
  stateIndex: number,
): Set<string> {
  const result = new Set<string>();
  for (const [prop, indices] of Object.entries(frame.valuation)) {
    if (indices.includes(stateIndex)) {
      result.add(prop);
    }
  }
  return result;
}

/**
 * Returns a Cytoscape stylesheet reflecting the current proposition selection.
 *
 * When `selectedProps` is empty, nodes are solid gray (#616161).
 * Otherwise, each node becomes a pie chart with |selectedProps| equal-angle
 * sectors: true-at-node sectors use the proposition's color, false sectors
 * use #2e2e2e.
 */
function buildStylesheet(
  frame: KripkeStructureJson,
  propositions: PropositionColoring[],
  selectedProps: Set<string>,
): (cytoscape.StylesheetStyle | cytoscape.StylesheetCSS)[] {
  const selected = propositions.filter((p) => selectedProps.has(p.name));

  const nodeStyle: Record<string, unknown> = {
    label: "data(label)",
    "text-valign": "center",
    "text-halign": "center",
    color: "#fff",
    "font-size": "12px",
    width: 40,
    height: 40,
  };

  if (selected.length === 0) {
    nodeStyle["background-color"] = INACTIVE_COLOR;
  } else {
    // Pre-compute per-node truth for selected propositions
    const nodeTruth = new Map<number, Set<string>>();
    for (let i = 0; i < frame.nodeCount; i++) {
      nodeTruth.set(i, new Set());
    }
    for (const { name } of selected) {
      const indices = frame.valuation[name];
      if (indices) {
        for (const idx of indices) {
          nodeTruth.get(idx)!.add(name);
        }
      }
    }

    nodeStyle["pie-size"] = "100%";
    const sectorSize = 100 / selected.length;

    for (let si = 0; si < selected.length; si++) {
      const n = si + 1; // Cytoscape pie slices are 1-indexed
      nodeStyle[`pie-${n}-background-size`] = sectorSize;
      const propName = selected[si].name;
      const propColor = selected[si].color;
      nodeStyle[`pie-${n}-background-color`] = (ele: cytoscape.NodeSingular) => {
        const stateIndex = ele.data("stateIndex") as number;
        return nodeTruth.get(stateIndex)?.has(propName) ? propColor : FALSE_SECTOR_COLOR;
      };
    }
  }

  return [
    { selector: "node", style: nodeStyle as cytoscape.Css.Node },
    {
      selector: "edge",
      style: {
        width: 2,
        "line-color": "#888",
        "target-arrow-color": "#888",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tooltip (DOM-based, no innerHTML to avoid XSS from user-provided JSON)
// ---------------------------------------------------------------------------

/**
 * Attaches a hover tooltip to Cytoscape nodes. Returns a cleanup function
 * that removes the DOM element and unregisters all event handlers.
 */
function setupTooltip(
  cy: cytoscape.Core,
  getFrame: () => KripkeStructureJson,
): () => void {
  const tooltipEl = document.createElement("div");
  Object.assign(tooltipEl.style, {
    position: "absolute",
    background: "#333",
    color: "#fff",
    padding: "6px 10px",
    borderRadius: "4px",
    fontSize: "12px",
    pointerEvents: "auto",
    zIndex: "1000",
    display: "none",
    maxHeight: "180px",
    overflowY: "auto",
    lineHeight: "1.6",
  });
  cy.container()?.appendChild(tooltipEl);

  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  const handleMouseOver = (e: cytoscape.EventObject) => {
    const node = e.target as cytoscape.NodeSingular;
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    const frame = getFrame();
    const stateIndex = node.data("stateIndex") as number;
    const trueProps = propositionsAt(frame, stateIndex);
    const allProps = Object.keys(frame.valuation).sort();

    // Build tooltip content safely via DOM (no innerHTML)
    tooltipEl.replaceChildren();
    if (allProps.length === 0) {
      tooltipEl.textContent = "(no propositions)";
    } else {
      for (const prop of allProps) {
        const line = document.createElement("div");
        line.textContent = `${trueProps.has(prop) ? "✅" : "❌"} ${prop}`;
        tooltipEl.appendChild(line);
      }
    }

    tooltipEl.style.display = "block";
    const pos = node.renderedPosition();
    tooltipEl.style.left = `${pos.x + 25}px`;
    tooltipEl.style.top = `${pos.y - 10}px`;
  };

  const scheduleHide = () => {
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      tooltipEl.style.display = "none";
    }, 100);
  };

  const handleMouseOut = () => scheduleHide();

  const handleTooltipEnter = () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  };

  const handleTooltipLeave = () => scheduleHide();

  cy.on("mouseover", "node", handleMouseOver);
  cy.on("mouseout", "node", handleMouseOut);
  tooltipEl.addEventListener("mouseenter", handleTooltipEnter);
  tooltipEl.addEventListener("mouseleave", handleTooltipLeave);

  return () => {
    if (hideTimeout) clearTimeout(hideTimeout);
    cy.off("mouseover", "node", handleMouseOver);
    cy.off("mouseout", "node", handleMouseOut);
    tooltipEl.removeEventListener("mouseenter", handleTooltipEnter);
    tooltipEl.removeEventListener("mouseleave", handleTooltipLeave);
    tooltipEl.remove();
  };
}

// ---------------------------------------------------------------------------
// Valuation selector widget
// ---------------------------------------------------------------------------

function ValuationSelector({
  propositions,
  selected,
  onToggle,
}: {
  propositions: PropositionColoring[];
  selected: Set<string>;
  onToggle: (name: string) => void;
}) {
  if (propositions.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        background: "rgba(255,255,255,0.95)",
        border: "1px solid #ccc",
        borderRadius: 6,
        padding: "8px 12px",
        fontSize: 13,
        zIndex: 500,
        maxHeight: 200,
        overflowY: "auto",
      }}
    >
      {propositions.map(({ name, color }) => (
        <label
          key={name}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            padding: "2px 0",
          }}
        >
          <input
            type="checkbox"
            checked={selected.has(name)}
            onChange={() => onToggle(name)}
          />
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              borderRadius: 2,
              background: color,
              flexShrink: 0,
            }}
          />
          {name}
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

export function KripkeVisualizerTab() {
  const [jsonText, setJsonText] = useState(
    JSON.stringify(SAMPLE_JSON, null, 2),
  );
  const [viz, setViz] = useState<KripkeStructureVisualizationJson>(SAMPLE_JSON);
  const [error, setError] = useState<string | null>(null);
  const [selectedProps, setSelectedProps] = useState<Set<string>>(new Set());
  const cyRef = useRef<cytoscape.Core | null>(null);
  const tooltipCleanupRef = useRef<(() => void) | null>(null);
  const vizRef = useRef(viz);
  vizRef.current = viz;

  const propositions = useMemo(() => resolvePropositionColors(viz), [viz]);

  const handleCy = useCallback((cy: cytoscape.Core) => {
    if (cyRef.current === cy) return;
    // Clean up previous tooltip if any
    tooltipCleanupRef.current?.();
    cyRef.current = cy;
    tooltipCleanupRef.current = setupTooltip(cy, () => vizRef.current.frame);
  }, []);

  // Apply pie-chart stylesheet whenever selection or data changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const sheet = buildStylesheet(viz.frame, propositions, selectedProps);
    cy.style(sheet as cytoscape.StylesheetCSS[]);
  }, [viz, selectedProps, propositions]);

  const handleParse = useCallback(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    const result = parseKripkeStructureVisualizationJson(parsed);
    if (typeof result === "string") {
      setError(result);
    } else {
      setViz(result);
      setError(null);
      setSelectedProps(new Set());
    }
  }, [jsonText]);

  const handleToggle = useCallback((name: string) => {
    setSelectedProps((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const stylesheet = buildStylesheet(viz.frame, propositions, selectedProps);

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        gap: 8,
        padding: 8,
      }}
    >
      {/* Input panel */}
      <div style={{ width: 230, display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          style={{
            flex: 1,
            fontFamily: "monospace",
            fontSize: 13,
            padding: 8,
            border: "1px solid #ccc",
            borderRadius: 4,
            resize: "none",
          }}
        />
        <button
          onClick={handleParse}
          style={{
            padding: "8px 16px",
            cursor: "pointer",
            borderRadius: 4,
            border: "1px solid #4a90d9",
            background: "#4a90d9",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          Parse &amp; Render
        </button>
        {error && (
          <div
            style={{
              padding: 8,
              background: "#fee",
              border: "1px solid #c66",
              borderRadius: 4,
              fontSize: 13,
              color: "#900",
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Graph panel */}
      <div
        style={{
          flex: 1,
          border: "1px solid #ccc",
          borderRadius: 4,
          minHeight: 300,
          position: "relative",
        }}
      >
        <ValuationSelector
          propositions={propositions}
          selected={selectedProps}
          onToggle={handleToggle}
        />
        <CytoscapeComponent
          elements={kripkeToElements(viz.frame)}
          style={{ width: "100%", height: "100%" }}
          layout={LAYOUT}
          stylesheet={stylesheet as cytoscape.StylesheetCSS[]}
          cy={handleCy}
        />
      </div>
    </div>
  );
}
