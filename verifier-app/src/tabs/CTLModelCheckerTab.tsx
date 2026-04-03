import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type cytoscape from "cytoscape";
import {
  type KripkeStructureJson,
  type KripkeStructureVisualizationJson,
  type KripkeStructureVisualizationParamsJson,
  parseKripkeStructureVisualizationJson,
} from "../types/kripke";
import { type CTLFormula, parseCTL, formulaToString } from "../types/ctl";
import { checkCTL } from "../types/ctlModelChecker";
import { FormulaVisualizer } from "../components/FormulaVisualizer";
import { createOutline, type IRectangle, type ILine } from "bubblesets-js";

// ---------------------------------------------------------------------------
// Color assignment
// ---------------------------------------------------------------------------

function autoColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

export interface PropositionColoring {
  readonly name: string;
  readonly color: string;
}

function resolvePropositionColors(
  viz: KripkeStructureVisualizationJson,
): PropositionColoring[] {
  const explicitColors = viz.visualizationParams?.colors ?? {};
  let autoIndex = 0;
  return Object.keys(viz.kripkeStructure.valuation).map((name) => ({
    name,
    color: explicitColors[name] ?? autoColor(autoIndex++),
  }));
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_JSON: KripkeStructureVisualizationJson = {
  kripkeStructure: {
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

const AUTO_LAYOUT: cytoscape.LayoutOptions = { name: "cose", animate: false };
const PRESET_LAYOUT: cytoscape.LayoutOptions = { name: "preset", animate: false };

function chooseLayout(
  params?: KripkeStructureVisualizationParamsJson,
): cytoscape.LayoutOptions {
  return params?.nodePositions ? PRESET_LAYOUT : AUTO_LAYOUT;
}

const INACTIVE_COLOR = "#616161";
const FALSE_SECTOR_COLOR = "#2e2e2e";

function kripkeToElements(
  kripkeStructure: KripkeStructureJson,
  nodePositions?: readonly (readonly [number, number])[],
): cytoscape.ElementDefinition[] {
  const nodes: cytoscape.ElementDefinition[] = Array.from(
    { length: kripkeStructure.nodeCount },
    (_, i) => ({
      data: { id: String(i), label: String(i), stateIndex: i },
      ...(nodePositions
        ? { position: { x: nodePositions[i][0], y: -nodePositions[i][1] } }
        : {}),
    }),
  );

  const seenEdges = new Set<string>();
  const edges: cytoscape.ElementDefinition[] = [];
  for (const [s, t] of kripkeStructure.transitions) {
    const key = `${s}->${t}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ data: { id: key, source: String(s), target: String(t) } });
  }

  return [...nodes, ...edges];
}

function propositionsAt(
  kripkeStructure: KripkeStructureJson,
  stateIndex: number,
): Set<string> {
  const result = new Set<string>();
  for (const [prop, indices] of Object.entries(kripkeStructure.valuation)) {
    if (indices.includes(stateIndex)) result.add(prop);
  }
  return result;
}

function buildStylesheet(
  kripkeStructure: KripkeStructureJson,
  propositions: PropositionColoring[],
  selectedProps: Set<string>,
): (cytoscape.StylesheetStyle | cytoscape.StylesheetCSS)[] {
  const selected = propositions.filter((p) => selectedProps.has(p.name));

  const nodeStyle: Record<string, unknown> = {
    label: "data(label)",
    "text-valign": "center",
    "text-halign": "center",
    color: "#fff",
    "font-family": "Martian Mono, monospace",
    "font-size": "12px",
    width: 40,
    height: 40,
  };

  if (selected.length === 0) {
    nodeStyle["background-color"] = INACTIVE_COLOR;
  } else {
    const nodeTruth = new Map<number, Set<string>>();
    for (let i = 0; i < kripkeStructure.nodeCount; i++) {
      nodeTruth.set(i, new Set());
    }
    for (const { name } of selected) {
      const indices = kripkeStructure.valuation[name];
      if (indices) {
        for (const idx of indices) nodeTruth.get(idx)!.add(name);
      }
    }

    nodeStyle["pie-size"] = "100%";
    const sectorSize = 100 / selected.length;
    for (let si = 0; si < selected.length; si++) {
      const n = si + 1;
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
// Tooltip
// ---------------------------------------------------------------------------

interface TooltipState {
  readonly stateIndex: number;
  readonly x: number;
  readonly y: number;
}

function NodeTooltip({
  tooltip,
  kripkeStructure,
  onMouseEnter,
  onMouseLeave,
}: {
  tooltip: TooltipState;
  kripkeStructure: KripkeStructureJson;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const trueProps = propositionsAt(kripkeStructure, tooltip.stateIndex);
  const allProps = Object.keys(kripkeStructure.valuation).sort();

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "absolute",
        left: tooltip.x + 25,
        top: tooltip.y - 10,
        background: "#333",
        color: "#fff",
        padding: "6px 10px",
        borderRadius: 4,
        fontSize: 12,
        pointerEvents: "auto",
        zIndex: 1000,
        maxHeight: 180,
        overflowY: "auto",
        lineHeight: "1.6",
      }}
    >
      {allProps.length === 0
        ? "(no propositions)"
        : allProps.map((prop) => (
            <div key={prop}>
              {trueProps.has(prop) ? "\u2705" : "\u274c"} {prop}
            </div>
          ))}
    </div>
  );
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
// Bubble Sets SVG overlay
// ---------------------------------------------------------------------------

const BUBBLE_SETS_OPTIONS = {
  pixelGroup: 2,
  nodeR0: 20,
  nodeR1: 40,
  morphBuffer: 8,
};

/**
 * Computes an SVG path string for a Bubble Set enclosing the given
 * member nodes while avoiding non-member nodes.
 *
 * All edges in the induced subgraph (edges where both endpoints are
 * members) are passed to the algorithm so that cycles are fully covered,
 * not just a spanning tree.
 *
 * The raw marching-squares output is smoothed via B-spline interpolation.
 *
 * Returns `null` if `memberIndices` is empty.
 */
function computeBubbleSetPath(
  cy: cytoscape.Core,
  memberIndices: ReadonlySet<number>,
  nodeCount: number,
  transitions: readonly (readonly [number, number])[],
): string | null {
  if (memberIndices.size === 0) return null;

  const members: IRectangle[] = [];
  const nonMembers: IRectangle[] = [];
  const nodePositions = new Map<number, { x: number; y: number }>();

  for (let i = 0; i < nodeCount; i++) {
    const node = cy.getElementById(String(i));
    if (node.empty()) continue;
    const pos = node.renderedPosition();
    const w = node.renderedWidth();
    const h = node.renderedHeight();
    const rect: IRectangle = { x: pos.x - w / 2, y: pos.y - h / 2, width: w, height: h };
    nodePositions.set(i, pos);
    if (memberIndices.has(i)) {
      members.push(rect);
    } else {
      nonMembers.push(rect);
    }
  }

  if (members.length === 0) return null;

  // Collect all edges in the induced subgraph (both endpoints are members)
  const edges: ILine[] = [];
  const seenEdges = new Set<string>();
  for (const [s, t] of transitions) {
    if (s === t) continue; // skip self-loops
    if (!memberIndices.has(s) || !memberIndices.has(t)) continue;
    const key = Math.min(s, t) + "," + Math.max(s, t);
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    const ps = nodePositions.get(s);
    const pt = nodePositions.get(t);
    if (ps && pt) {
      edges.push({ x1: ps.x, y1: ps.y, x2: pt.x, y2: pt.y });
    }
  }

  const outline = createOutline(members, nonMembers, edges, BUBBLE_SETS_OPTIONS);
  if (outline.points.length === 0) return null;
  return outline.sample(8).simplify(0).bSplines().simplify(0).toString();
}

// ---------------------------------------------------------------------------
// Floating formula panel
// ---------------------------------------------------------------------------

function FormulaPanel({
  viz,
  formula,
  formulaText,
  formulaError,
  satMap,
  hoveredFormula,
  onFormulaTextChange,
  onHover,
}: {
  viz: KripkeStructureVisualizationJson;
  formula: CTLFormula | null;
  formulaText: string;
  formulaError: string | null;
  satMap: Map<CTLFormula, ReadonlySet<number>> | null;
  hoveredFormula: CTLFormula | null;
  onFormulaTextChange: (text: string) => void;
  onHover: (f: CTLFormula | null) => void;
}) {
  const hoveredSat = hoveredFormula && satMap?.get(hoveredFormula);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        right: 12,
        width: 680,
        maxHeight: "70%",
        background: "rgba(40, 40, 48, 0.96)",
        border: "1px solid #555",
        borderRadius: 10,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        zIndex: 600,
        color: "#eee",
        fontSize: 22,
        boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 24 }}>CTL Formula to Check</div>

      {/* Formula visualizer */}
      {formula && (
        <div
          style={{
            overflow: "auto",
            maxHeight: 400,
            background: "rgba(0,0,0,0.2)",
            borderRadius: 6,
            padding: 12,
          }}
        >
          <FormulaVisualizer
            formula={formula}
            hoveredFormula={hoveredFormula}
            onHover={onHover}
          />
        </div>
      )}

      {/* Satisfaction info — always present to avoid layout shifts */}
      <div style={{ fontSize: 18, color: "#aaa", height: 24, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 0 }}>
        {hoveredFormula && hoveredSat != null ? (
          <>
            <span style={{ color: "#7ec8e3" }}>{formulaToString(hoveredFormula)}</span>
            {" "}satisfied at {hoveredSat.size} of {viz.kripkeStructure.nodeCount} state{viz.kripkeStructure.nodeCount !== 1 ? "s" : ""}
          </>
        ) : (
          "\u00A0" /* non-breaking space to reserve line height */
        )}
      </div>

      {/* Textarea */}
      <textarea
        value={formulaText}
        onChange={(e) => onFormulaTextChange(e.target.value)}
        placeholder="e.g. AG (init -> EX busy)"
        style={{
          fontFamily: "Martian Mono, monospace",
          fontSize: 22,
          padding: 12,
          border: "1px solid #555",
          borderRadius: 6,
          background: "#1e1e24",
          color: "#eee",
          resize: "vertical",
          minHeight: 60,
        }}
      />
      {formulaError && (
        <div style={{ color: "#f88", fontSize: 18 }}>{formulaError}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

export function CTLModelCheckerTab() {
  const [jsonText, setJsonText] = useState(JSON.stringify(SAMPLE_JSON, null, 2));
  const [viz, setViz] = useState<KripkeStructureVisualizationJson>(SAMPLE_JSON);
  const [error, setError] = useState<string | null>(null);
  const [selectedProps, setSelectedProps] = useState<Set<string>>(new Set());
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // CTL formula state
  const [formulaText, setFormulaText] = useState("AG (init -> EX busy)");
  const [hoveredFormula, setHoveredFormula] = useState<CTLFormula | null>(null);

  // Bubble set SVG overlay
  const svgRef = useRef<SVGSVGElement | null>(null);
  const graphContainerRef = useRef<HTMLDivElement | null>(null);

  const propositions = useMemo(() => resolvePropositionColors(viz), [viz]);

  // Parse formula
  const { formula, formulaError } = useMemo(() => {
    if (!formulaText.trim()) return { formula: null, formulaError: null };
    const result = parseCTL(formulaText);
    if (typeof result === "string") return { formula: null, formulaError: result };
    return { formula: result, formulaError: null };
  }, [formulaText]);

  // Model check
  const satMap = useMemo(() => {
    if (!formula) return null;
    return checkCTL(viz.kripkeStructure, formula);
  }, [viz, formula]);

  // Compute bubble set path for hovered subformula
  const [bubblePath, setBubblePath] = useState<string | null>(null);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !hoveredFormula || !satMap) {
      setBubblePath(null);
      return;
    }
    const sat = satMap.get(hoveredFormula);
    if (!sat || sat.size === 0) {
      setBubblePath(null);
      return;
    }
    const path = computeBubbleSetPath(cy, sat, viz.kripkeStructure.nodeCount, viz.kripkeStructure.transitions);
    setBubblePath(path);
  }, [hoveredFormula, satMap, viz.kripkeStructure.nodeCount]);

  // Sync SVG overlay size and viewport with Cytoscape
  const updateSvgOverlay = useCallback(() => {
    const svg = svgRef.current;
    const container = graphContainerRef.current;
    if (!svg || !container) return;
    svg.setAttribute("width", String(container.clientWidth));
    svg.setAttribute("height", String(container.clientHeight));
  }, []);

  useEffect(() => {
    const container = graphContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(updateSvgOverlay);
    observer.observe(container);
    return () => observer.disconnect();
  }, [updateSvgOverlay]);

  const scheduleHide = useCallback(() => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => setTooltip(null), 100);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const handleCy = useCallback(
    (cy: cytoscape.Core) => {
      if (cyRef.current === cy) return;
      cyRef.current = cy;

      cy.on("mouseover", "node", (e) => {
        cancelHide();
        const node = e.target as cytoscape.NodeSingular;
        const pos = node.renderedPosition();
        setTooltip({ stateIndex: node.data("stateIndex") as number, x: pos.x, y: pos.y });
      });
      cy.on("mouseout", "node", scheduleHide);

      // Update bubble set on viewport changes
      cy.on("pan zoom resize", updateSvgOverlay);
    },
    [cancelHide, scheduleHide, updateSvgOverlay],
  );

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const sheet = buildStylesheet(viz.kripkeStructure, propositions, selectedProps);
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
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const stylesheet = buildStylesheet(viz.kripkeStructure, propositions, selectedProps);

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        gap: 8,
        padding: 8,
        overflow: "hidden",
      }}
    >
      {/* Input panel */}
      <div style={{ width: 230, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
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
        ref={graphContainerRef}
        style={{
          flex: 1,
          minWidth: 0,
          border: "1px solid #ccc",
          borderRadius: 4,
          position: "relative",
        }}
      >
        <ValuationSelector
          propositions={propositions}
          selected={selectedProps}
          onToggle={handleToggle}
        />
        <CytoscapeComponent
          elements={kripkeToElements(viz.kripkeStructure, viz.visualizationParams?.nodePositions)}
          style={{ width: "100%", height: "100%" }}
          layout={chooseLayout(viz.visualizationParams)}
          stylesheet={stylesheet as cytoscape.StylesheetCSS[]}
          cy={handleCy}
        />

        {/* Bubble Set SVG overlay */}
        <svg
          ref={svgRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 400,
          }}
        >
          {bubblePath && (
            <path
              d={bubblePath}
              fill="rgba(60, 130, 240, 0.25)"
              stroke="rgba(60, 130, 240, 0.7)"
              strokeWidth={3}
              strokeLinejoin="round"
            />
          )}
        </svg>

        {tooltip && (
          <NodeTooltip
            tooltip={tooltip}
            kripkeStructure={viz.kripkeStructure}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
          />
        )}

        {/* Floating formula panel */}
        <FormulaPanel
          viz={viz}
          formula={formula}
          formulaText={formulaText}
          formulaError={formulaError}
          satMap={satMap}
          hoveredFormula={hoveredFormula}
          onFormulaTextChange={setFormulaText}
          onHover={setHoveredFormula}
        />
      </div>
    </div>
  );
}
