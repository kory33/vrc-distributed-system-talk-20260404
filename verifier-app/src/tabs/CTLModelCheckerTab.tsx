import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type cytoscape from "cytoscape";
import {
  type KripkeStructureJson,
  type KripkeStructureVisualizationJson,
  type KripkeStructureVisualizationParamsJson,
  parseKripkeStructureVisualizationJson,
} from "../types/kripke";
import { type CTLFormula, parseCTL, formulaToDisplayString } from "../types/ctl";
import { checkCTL } from "../types/ctlModelChecker";
import { isInUniversalFragment, generateCounterexampleTrace } from "../types/ctlCounterexample";
import { FormulaVisualizer } from "../components/FormulaVisualizer";
import { createOutline, type IRectangle, type ILine } from "bubblesets-js";
import katex from "katex";

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
  defaultCTLFormulaToCheck: "AG (init -> EX busy)",
};

// ---------------------------------------------------------------------------
// Cytoscape helpers
// ---------------------------------------------------------------------------

const AUTO_LAYOUT = { name: "fcose" as const, animate: false };
const PRESET_LAYOUT = { name: "preset" as const, animate: false };

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
      position: nodePositions
        ? { x: nodePositions[i][0], y: -nodePositions[i][1] }
        : { x: Math.random() * 1000, y: Math.random() * 1000 },
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
// Formula Syntax modal
// ---------------------------------------------------------------------------

function Tex({ children }: { children: string }) {
  const html = useMemo(
    () => katex.renderToString(children, { throwOnError: false, displayMode: false }),
    [children],
  );
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function FormulaSyntaxModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#2a2a32",
          border: "1px solid #555",
          borderRadius: 10,
          padding: 28,
          maxWidth: 740,
          maxHeight: "80vh",
          overflowY: "auto",
          color: "#eee",
          fontSize: 15,
          lineHeight: 1.7,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 20 }}>CTL Formula Syntax</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#aaa",
              fontSize: 22,
              cursor: "pointer",
              padding: "0 4px",
            }}
          >
            &times;
          </button>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #555" }}>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#aaa" }}>Syntax</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#aaa" }}>Symbol</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#aaa" }}>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {([
              { syntax: "true / false", symbol: "\\top \\;/\\; \\bot", meaning: "always true / always false" },
              { syntax: "p, q, ...", symbol: null, meaning: "atomic propositions (named labels on states)" },
              { syntax: "!<fml>", symbol: "\\neg\\varphi", meaning: "\"not\" — true when the inner formula is false" },
              { syntax: "<fml> && <fml>", symbol: "\\varphi \\wedge \\psi", meaning: "\"and\" — true when both sides hold" },
              { syntax: "<fml> || <fml>", symbol: "\\varphi \\vee \\psi", meaning: "\"or\" — true when at least one side holds" },
              { syntax: "<fml> -> <fml>", symbol: "\\varphi \\to \\psi", meaning: "\"implies\" — false only when the left side is true but the right side is false" },
              { syntax: "AX <fml>", symbol: "\\forall\\vcenter{\\LARGE\\circ}\\;\\varphi", meaning: "the inner formula holds at every next state" },
              { syntax: "EX <fml>", symbol: "\\exists\\vcenter{\\LARGE\\circ}\\;\\varphi", meaning: "the inner formula holds at some next state" },
              { syntax: "AF <fml>", symbol: "\\forall\\Diamond\\;\\varphi", meaning: "no matter which path we take, the inner formula will become true eventually" },
              { syntax: "EF <fml>", symbol: "\\exists\\Diamond\\;\\varphi", meaning: "there is a path along which the inner formula becomes true eventually" },
              { syntax: "AG <fml>", symbol: "\\forall\\Box\\;\\varphi", meaning: "the inner formula stays true forever, no matter which path we take" },
              { syntax: "EG <fml>", symbol: "\\exists\\Box\\;\\varphi", meaning: "there is a path along which the inner formula stays true forever" },
              { syntax: "A[ <fml> U <fml> ]", symbol: "\\forall\\mathsf{U}(\\varphi,\\,\\psi)", meaning: "on every path, the right formula becomes true at some point and until then the left formula keeps holding" },
              { syntax: "E[ <fml> U <fml> ]", symbol: "\\exists\\mathsf{U}(\\varphi,\\,\\psi)", meaning: "on some path, the right formula becomes true at some point and until then the left formula keeps holding" },
              { syntax: "( <fml> )", symbol: null, meaning: "group a subformula (controls evaluation order)" },
            ] as const).map(({ syntax, symbol, meaning }) => (
              <tr key={syntax} style={{ borderBottom: "1px solid #3a3a42" }}>
                <td style={{ padding: "5px 8px", fontFamily: "Martian Mono, monospace", fontSize: 14, whiteSpace: "nowrap" }}>{syntax}</td>
                <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{symbol && <Tex>{symbol}</Tex>}</td>
                <td style={{ padding: "5px 8px" }}>{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ color: "#aaa", fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#ccc" }}>Precedence (high to low)</div>
          <div>! &gt; AX EX AF EF AG EG &gt; &amp;&amp; &gt; || &gt; -&gt;</div>
          <div style={{ marginTop: 10, fontWeight: 600, marginBottom: 4, color: "#ccc" }}>Examples</div>
          <div style={{ fontFamily: "Martian Mono, monospace", fontSize: 13 }}>
            <div>AG (init -&gt; EX busy)</div>
            <div>E[ light1_red U light1_green ]</div>
            <div>!EF (light1_green &amp;&amp; light2_green)</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trace modal
// ---------------------------------------------------------------------------

function TraceModal({ json, onClose }: { json: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#2a2a32",
          border: "1px solid #555",
          borderRadius: 10,
          padding: 28,
          maxWidth: 740,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          color: "#eee",
          fontSize: 15,
          lineHeight: 1.7,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 20 }}>Counterexample Trace</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#aaa",
              fontSize: 22,
              cursor: "pointer",
              padding: "0 4px",
            }}
          >
            &times;
          </button>
        </div>
        <pre
          style={{
            flex: 1,
            overflow: "auto",
            background: "#1e1e24",
            padding: 16,
            borderRadius: 6,
            fontSize: 13,
            fontFamily: "Martian Mono, monospace",
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {json}
        </pre>
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <button
            onClick={() => {
              navigator.clipboard.writeText(json);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            style={{
              padding: "6px 16px",
              borderRadius: 4,
              border: "1px solid #4a90d9",
              background: "#4a90d9",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formula panel (floating overlay on the graph)
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
  const [showSyntax, setShowSyntax] = useState(false);
  const [traceJson, setTraceJson] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(680);
  const hoveredSat = hoveredFormula && satMap?.get(hoveredFormula);

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    const pointerId = e.pointerId;
    (e.target as HTMLElement).setPointerCapture(pointerId);

    const onMove = (ev: PointerEvent) => {
      // Dragging left edge: moving left increases width
      setPanelWidth(Math.max(300, startWidth + (startX - ev.clientX)));
    };
    const onUp = () => {
      (e.target as HTMLElement).releasePointerCapture(pointerId);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [panelWidth]);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        right: 12,
        width: panelWidth,
        maxWidth: "90%",
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
      {/* Left-edge resize handle */}
      <div
        onPointerDown={handleResizePointerDown}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 6,
          height: "100%",
          cursor: "ew-resize",
          zIndex: 1,
        }}
      />

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
            <span style={{ color: "#7ec8e3" }}>{formulaToDisplayString(hoveredFormula)}</span>
            {" "}satisfied at {hoveredSat.size} of {viz.kripkeStructure.nodeCount} state{viz.kripkeStructure.nodeCount !== 1 ? "s" : ""}
          </>
        ) : formula && satMap ? (() => {
          const rootSat = satMap.get(formula);
          const n = viz.kripkeStructure.nodeCount;
          if (!rootSat || rootSat.size === 0) return <span style={{ color: "#f88" }}>Not satisfied at any state</span>;
          if (rootSat.size === n) return <span style={{ color: "#8f8" }}>Valid at all {n} states</span>;
          const counterexamples: number[] = [];
          for (let i = 0; i < n; i++) { if (!rootSat.has(i)) counterexamples.push(i); }
          const canTrace = isInUniversalFragment(formula);
          return (
            <span style={{ color: "#f88" }}>
              Counterexamples: {"{" + counterexamples.join(", ") + "}"}
              {canTrace && (
                <>
                  {" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      const trace = generateCounterexampleTrace(
                        viz.kripkeStructure, satMap, formula, counterexamples[0],
                      );
                      if (trace) setTraceJson(JSON.stringify(trace, null, 2));
                    }}
                    style={{ color: "#7ec8e3", fontSize: 14, textDecoration: "none" }}
                  >
                    Show trace
                  </a>
                </>
              )}
            </span>
          );
        })() : (
          "\u00A0"
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
      <div style={{ textAlign: "right", marginTop: -10, lineHeight: 1 }}>
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); setShowSyntax(true); }}
          style={{ color: "#7ec8e3", fontSize: 13, textDecoration: "none" }}
        >
          Formula Syntax
        </a>
      </div>
      {formulaError && (
        <div style={{ color: "#f88", fontSize: 18 }}>{formulaError}</div>
      )}
      {showSyntax && <FormulaSyntaxModal onClose={() => setShowSyntax(false)} />}
      {traceJson && (
        <TraceModal json={traceJson} onClose={() => setTraceJson(null)} />
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
  const [formulaText, setFormulaText] = useState(SAMPLE_JSON.defaultCTLFormulaToCheck ?? "");
  const [hoveredFormula, setHoveredFormula] = useState<CTLFormula | null>(null);

  // Bubble set SVG overlay
  const svgRef = useRef<SVGSVGElement | null>(null);
  const graphContainerRef = useRef<HTMLDivElement | null>(null);

  const propositions = useMemo(() => resolvePropositionColors(viz), [viz]);
  const elements = useMemo(
    () => kripkeToElements(viz.kripkeStructure, viz.visualizationParams?.nodePositions),
    [viz],
  );

  // Parse formula
  const { formula, formulaError } = useMemo(() => {
    if (!formulaText.trim()) return { formula: null, formulaError: null };
    const result = parseCTL(formulaText);
    if (typeof result === "string") return { formula: null, formulaError: result };
    return { formula: result, formulaError: null };
  }, [formulaText]);

  // Clear hoveredFormula when the formula tree is replaced
  useEffect(() => {
    setHoveredFormula(null);
  }, [formula]);

  // Model check
  const satMap = useMemo(() => {
    if (!formula) return null;
    return checkCTL(viz.kripkeStructure, formula);
  }, [viz, formula]);

  // Compute bubble set path for hovered subformula
  const [bubblePath, setBubblePath] = useState<string | null>(null);

  const refreshBubblePath = useCallback(() => {
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
  }, [hoveredFormula, satMap, viz.kripkeStructure.nodeCount, viz.kripkeStructure.transitions]);

  // Recompute bubble path when hover or data changes
  useEffect(() => {
    refreshBubblePath();
  }, [refreshBubblePath]);

  // Sync SVG overlay size with container
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

  // Refs to avoid stale closures in Cytoscape event handlers
  const refreshBubblePathRef = useRef(refreshBubblePath);
  useEffect(() => { refreshBubblePathRef.current = refreshBubblePath; }, [refreshBubblePath]);

  const hoveredNodeRef = useRef<cytoscape.NodeSingular | null>(null);

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
        const node = e.target as cytoscape.NodeSingular;
        hoveredNodeRef.current = node;
        cancelHide();
        const pos = node.renderedPosition();
        setTooltip({ stateIndex: node.data("stateIndex") as number, x: pos.x, y: pos.y });
      });
      cy.on("mouseout", "node", () => {
        hoveredNodeRef.current = null;
        scheduleHide();
      });
    },
    [cancelHide, scheduleHide],
  );

  // Separate effect for viewport change listener — reads from refs
  // so it always calls the latest refreshBubblePath and updates tooltip position.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const handleViewportChange = () => {
      updateSvgOverlay();
      refreshBubblePathRef.current();
      const node = hoveredNodeRef.current;
      if (node) {
        const pos = node.renderedPosition();
        setTooltip({ stateIndex: node.data("stateIndex") as number, x: pos.x, y: pos.y });
      }
    };
    cy.on("pan zoom resize layoutstop", handleViewportChange);
    return () => { cy.off("pan zoom resize layoutstop", handleViewportChange); };
  }, [updateSvgOverlay]);

  // Imperatively reapply stylesheet when selection or data changes,
  // since CytoscapeComponent only applies the declarative stylesheet on mount.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || viz.visualizationParams?.nodePositions) return;
    cy.layout(AUTO_LAYOUT).run();
  }, [viz]);

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
      if (result.defaultCTLFormulaToCheck !== undefined) {
        setFormulaText(result.defaultCTLFormulaToCheck);
      }
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
        <div style={{ marginTop: 4, fontSize: 13 }}>
          <a
            href="https://github.com/kory33/vrc-distributed-system-talk-20260404/tree/main/verifier-app/generating-scripts"
            target="_blank"
            rel="noopener noreferrer"
          >
            Standalone model-generating scripts
          </a>
        </div>
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
          elements={elements}
          style={{ width: "100%", height: "100%" }}
          layout={chooseLayout(viz.visualizationParams)}
          stylesheet={stylesheet as cytoscape.StylesheetCSS[]}
          wheelSensitivity={3}
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
