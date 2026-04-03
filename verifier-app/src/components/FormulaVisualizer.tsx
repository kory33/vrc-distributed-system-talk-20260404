/**
 * Nested-box visualization of a CTL formula's tree structure.
 *
 * The tree structure is conveyed purely by box nesting. Operators and
 * operands are laid out **horizontally at the same y-coordinate** so
 * that the entire visualization has a fixed vertical rhythm regardless
 * of depth.
 *
 * Layout rules:
 *   - Leaf (atom / true / false): a single labeled box.
 *   - Unary prefix (¬, ∀○, ∃○, ...): `[ op  [child] ]`
 *   - Binary infix (∧, ∨, →): `[ [left]  op  [right] ]`
 *   - Binary prefix (∀U, ∃U): `[ op( [left] , [right] ) ]`
 *
 * Operator symbols are rendered via KaTeX; propositional variable names
 * are rendered as plain text.
 *
 * Hovering over a box triggers `onHover(subformula)`;
 * leaving triggers `onHover(null)`.
 */

import { useMemo, useCallback } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { CTLFormula } from "../types/ctl";
import { formulaLatex } from "../types/ctl";

// ---------------------------------------------------------------------------
// Color palette for nesting depth
// ---------------------------------------------------------------------------

const DEPTH_COLORS = [
  "rgba(100, 149, 237, 0.15)", // cornflower blue
  "rgba(144, 238, 144, 0.15)", // light green
  "rgba(255, 182, 108, 0.15)", // peach
  "rgba(216, 160, 255, 0.15)", // lavender
  "rgba(255, 200, 200, 0.15)", // pink
  "rgba(200, 230, 255, 0.15)", // ice blue
];

const DEPTH_BORDER_COLORS = [
  "rgba(100, 149, 237, 0.6)",
  "rgba(80, 180, 80, 0.6)",
  "rgba(220, 140, 50, 0.6)",
  "rgba(160, 100, 220, 0.6)",
  "rgba(220, 100, 100, 0.6)",
  "rgba(100, 160, 220, 0.6)",
];

// ---------------------------------------------------------------------------
// KaTeX rendering helper
// ---------------------------------------------------------------------------

/** Pre-rendered KaTeX HTML cache (LaTeX source → HTML string). */
const katexCache = new Map<string, string>();

function renderKatex(latex: string): string {
  let html = katexCache.get(latex);
  if (html === undefined) {
    html = katex.renderToString(latex, { throwOnError: false, displayMode: false });
    katexCache.set(latex, html);
  }
  return html;
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const PLAIN_LABEL_STYLE: React.CSSProperties = {
  fontSize: 26,
  fontFamily: "Martian Mono, monospace",
  color: "#ddd",
  userSelect: "none",
  whiteSpace: "nowrap",
};

const KATEX_LABEL_STYLE: React.CSSProperties = {
  fontSize: 26,
  color: "#ddd",
  userSelect: "none",
  whiteSpace: "nowrap",
  display: "inline-flex",
  alignItems: "center",
};

// ---------------------------------------------------------------------------
// Label component
// ---------------------------------------------------------------------------

/**
 * Renders a formula's operator label. Uses KaTeX for mathematical
 * operators; plain monospace text for propositional variable names.
 */
function OperatorLabel({ formula }: { formula: CTLFormula }) {
  const latex = formulaLatex(formula);
  const html = useMemo(() => (latex !== null ? renderKatex(latex) : null), [latex]);

  if (html !== null) {
    return <span style={KATEX_LABEL_STYLE} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  // Atom: plain text
  return <span style={PLAIN_LABEL_STYLE}>{(formula as Extract<CTLFormula, { tag: "atom" }>).name}</span>;
}

/**
 * Renders a small KaTeX fragment for punctuation (comma, parentheses)
 * that appears alongside operator labels.
 */
function MathPunct({ latex }: { latex: string }) {
  const html = useMemo(() => renderKatex(latex), [latex]);
  return <span style={KATEX_LABEL_STYLE} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FormulaVisualizer({
  formula,
  hoveredFormula,
  onHover,
}: {
  formula: CTLFormula;
  hoveredFormula: CTLFormula | null;
  onHover: (f: CTLFormula | null) => void;
}) {
  // Only the root clears the hover (on mouseleave). Individual boxes
  // set hover via mouseover (which bubbles), with stopPropagation so
  // only the innermost box fires.
  const handleClearHover = useCallback(() => onHover(null), [onHover]);

  return (
    <div style={{ overflow: "auto", padding: 4 }} onMouseOver={handleClearHover} onMouseLeave={handleClearHover}>
      <FormulaBox
        formula={formula}
        depth={0}
        hoveredFormula={hoveredFormula}
        onHover={onHover}
      />
    </div>
  );
}

/**
 * Returns true when the formula's outer connector is a binary infix operator
 * (∧, ∨, →), meaning the operator label appears *between* the two child boxes.
 */
function isBinaryInfix(f: CTLFormula): f is
  | Extract<CTLFormula, { tag: "and" | "or" | "implies" }> {
  return f.tag === "and" || f.tag === "or" || f.tag === "implies";
}

/**
 * Returns true when the formula's outer connector is a binary prefix operator
 * (∀U, ∃U), rendered as `op(left, right)` with the operator label before
 * the two comma-separated child boxes.
 */
function isBinaryPrefix(f: CTLFormula): f is
  | Extract<CTLFormula, { tag: "AU" | "EU" }> {
  return f.tag === "AU" || f.tag === "EU";
}

/**
 * Returns true when the formula's outer connector is a unary prefix operator,
 * meaning the operator label appears *before* the single child box.
 */
function isUnaryPrefix(f: CTLFormula): f is
  | Extract<CTLFormula, { tag: "not" | "AX" | "EX" | "AF" | "EF" | "AG" | "EG" }> {
  return (
    f.tag === "not" ||
    f.tag === "AX" ||
    f.tag === "EX" ||
    f.tag === "AF" ||
    f.tag === "EF" ||
    f.tag === "AG" ||
    f.tag === "EG"
  );
}

function FormulaBox({
  formula,
  depth,
  hoveredFormula,
  onHover,
}: {
  formula: CTLFormula;
  depth: number;
  hoveredFormula: CTLFormula | null;
  onHover: (f: CTLFormula | null) => void;
}) {
  const colorIndex = depth % DEPTH_COLORS.length;
  const isHovered = hoveredFormula === formula;

  // mouseover bubbles, so the innermost box that stopPropagates wins.
  // When the mouse moves from an inner box to an outer box's padding,
  // mouseover fires on the outer box, correctly updating the hover.
  const handleMouseOver = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onHover(formula);
    },
    [formula, onHover],
  );

  const boxStyle: React.CSSProperties = {
    display: "inline-flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    border: `2px solid ${isHovered ? "#fff" : DEPTH_BORDER_COLORS[colorIndex]}`,
    borderRadius: 7,
    background: isHovered ? "rgba(255, 255, 255, 0.12)" : DEPTH_COLORS[colorIndex],
    cursor: "pointer",
    transition: "background 0.1s, border-color 0.1s",
    boxShadow: isHovered ? "0 0 6px rgba(255,255,255,0.3)" : "none",
  };

  const childProps = {
    depth: depth + 1,
    hoveredFormula,
    onHover,
  };

  // Leaf: just the label
  if (formula.tag === "true" || formula.tag === "false" || formula.tag === "atom") {
    return (
      <div onMouseOver={handleMouseOver} style={boxStyle}>
        <OperatorLabel formula={formula} />
      </div>
    );
  }

  // Unary prefix:  [ op  [child] ]
  if (isUnaryPrefix(formula)) {
    return (
      <div onMouseOver={handleMouseOver} style={boxStyle}>
        <OperatorLabel formula={formula} />
        <FormulaBox formula={formula.sub} {...childProps} />
      </div>
    );
  }

  // Binary infix:  [ [left]  op  [right] ]
  if (isBinaryInfix(formula)) {
    return (
      <div onMouseOver={handleMouseOver} style={boxStyle}>
        <FormulaBox formula={formula.left} {...childProps} />
        <OperatorLabel formula={formula} />
        <FormulaBox formula={formula.right} {...childProps} />
      </div>
    );
  }

  // Binary prefix (until):  [ op( [left] , [right] ) ]
  if (isBinaryPrefix(formula)) {
    return (
      <div onMouseOver={handleMouseOver} style={boxStyle}>
        <OperatorLabel formula={formula} />
        <MathPunct latex="(" />
        <FormulaBox formula={formula.left} {...childProps} />
        <MathPunct latex=",\;" />
        <FormulaBox formula={formula.right} {...childProps} />
        <MathPunct latex=")" />
      </div>
    );
  }

  // Exhaustiveness: should never reach here
  return null;
}
