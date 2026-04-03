/**
 * CTL (Computation Tree Logic) formula representation and parser.
 *
 * A CTL formula is inductively defined as:
 *   φ ::= true | false | p | ¬φ | φ ∧ φ | φ ∨ φ | φ → φ
 *        | AX φ | EX φ | AF φ | EF φ | AG φ | EG φ
 *        | A[φ U φ] | E[φ U φ]
 *
 * where p is an atomic proposition name.
 */

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type CTLFormula =
  | { readonly tag: "true" }
  | { readonly tag: "false" }
  | { readonly tag: "atom"; readonly name: string }
  | { readonly tag: "not"; readonly sub: CTLFormula }
  | { readonly tag: "and"; readonly left: CTLFormula; readonly right: CTLFormula }
  | { readonly tag: "or"; readonly left: CTLFormula; readonly right: CTLFormula }
  | { readonly tag: "implies"; readonly left: CTLFormula; readonly right: CTLFormula }
  | { readonly tag: "AX"; readonly sub: CTLFormula }
  | { readonly tag: "EX"; readonly sub: CTLFormula }
  | { readonly tag: "AF"; readonly sub: CTLFormula }
  | { readonly tag: "EF"; readonly sub: CTLFormula }
  | { readonly tag: "AG"; readonly sub: CTLFormula }
  | { readonly tag: "EG"; readonly sub: CTLFormula }
  | { readonly tag: "AU"; readonly left: CTLFormula; readonly right: CTLFormula }
  | { readonly tag: "EU"; readonly left: CTLFormula; readonly right: CTLFormula };

// ---------------------------------------------------------------------------
// Pretty-printing
// ---------------------------------------------------------------------------

/** Returns a Unicode string representation of a CTL formula. */
export function formulaToString(f: CTLFormula): string {
  switch (f.tag) {
    case "true": return "⊤";
    case "false": return "⊥";
    case "atom": return f.name;
    case "not": return `¬${wrapIfCompound(f.sub)}`;
    case "and": return `${wrapIfCompound(f.left)} ∧ ${wrapIfCompound(f.right)}`;
    case "or": return `${wrapIfCompound(f.left)} ∨ ${wrapIfCompound(f.right)}`;
    case "implies": return `${wrapIfCompound(f.left)} → ${wrapIfCompound(f.right)}`;
    case "AX": return `∀○ ${wrapIfCompound(f.sub)}`;
    case "EX": return `∃○ ${wrapIfCompound(f.sub)}`;
    case "AF": return `∀♢ ${wrapIfCompound(f.sub)}`;
    case "EF": return `∃♢ ${wrapIfCompound(f.sub)}`;
    case "AG": return `∀□ ${wrapIfCompound(f.sub)}`;
    case "EG": return `∃□ ${wrapIfCompound(f.sub)}`;
    case "AU": return `∀U(${formulaToString(f.left)}, ${formulaToString(f.right)})`;
    case "EU": return `∃U(${formulaToString(f.left)}, ${formulaToString(f.right)})`;
  }
}

function wrapIfCompound(f: CTLFormula): string {
  const s = formulaToString(f);
  return isCompound(f) ? `(${s})` : s;
}

function isCompound(f: CTLFormula): boolean {
  return f.tag === "and" || f.tag === "or" || f.tag === "implies";
}

// ---------------------------------------------------------------------------
// Label: short operator label for display in nested-box visualizer
// ---------------------------------------------------------------------------

/**
 * Returns a LaTeX string for the outermost operator of a formula,
 * or `null` for atoms (which should be rendered as plain text).
 *
 * The returned string is intended for KaTeX inline rendering.
 */
export function formulaLatex(f: CTLFormula): string | null {
  switch (f.tag) {
    case "true": return "\\top";
    case "false": return "\\bot";
    case "atom": return null;
    case "not": return "\\neg";
    case "and": return "\\wedge";
    case "or": return "\\vee";
    case "implies": return "\\to";
    case "AX": return "\\forall\\vcenter{\\LARGE\\circ}";
    case "EX": return "\\exists\\vcenter{\\LARGE\\circ}";
    case "AF": return "\\forall\\Diamond";
    case "EF": return "\\exists\\Diamond";
    case "AG": return "\\forall\\Box";
    case "EG": return "\\exists\\Box";
    case "AU": return "\\forall\\mathsf{U}";
    case "EU": return "\\exists\\mathsf{U}";
  }
}

/**
 * Returns all direct children of a formula node.
 */
export function formulaChildren(f: CTLFormula): CTLFormula[] {
  switch (f.tag) {
    case "true":
    case "false":
    case "atom":
      return [];
    case "not":
    case "AX": case "EX":
    case "AF": case "EF":
    case "AG": case "EG":
      return [f.sub];
    case "and": case "or": case "implies":
    case "AU": case "EU":
      return [f.left, f.right];
  }
}

/**
 * Collects all subformulae of `f` (including `f` itself) in a
 * depth-first, pre-order traversal. Each subformula appears by
 * reference identity, so the result can be used as keys in a Map.
 */
export function allSubformulae(f: CTLFormula): CTLFormula[] {
  const result: CTLFormula[] = [];
  const visit = (node: CTLFormula) => {
    result.push(node);
    for (const child of formulaChildren(node)) {
      visit(child);
    }
  };
  visit(f);
  return result;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Token types produced by the lexer.
 *
 * - `ident`: atomic proposition names, keywords (true/false), and
 *   temporal operator names (AX, EX, AF, EF, AG, EG, AU, EU)
 * - `op`: multi-character operators (&&, ||, ->, A[, E[)
 * - `punct`: single-character punctuation (!, (, ), [, ], U when inside brackets)
 */
interface Token {
  readonly type: "ident" | "op" | "punct";
  readonly value: string;
  readonly pos: number;
}

const KEYWORDS = new Set([
  "true", "false",
  "AX", "EX", "AF", "EF", "AG", "EG",
]);

/**
 * Tokenizes a CTL formula string.
 * Returns an array of tokens or an error string.
 */
function tokenize(input: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) { i++; continue; }

    const pos = i;

    // Two-character operators
    if (i + 1 < input.length) {
      const two = input.slice(i, i + 2);
      if (two === "&&" || two === "||" || two === "->") {
        tokens.push({ type: "op", value: two, pos });
        i += 2;
        continue;
      }
      // A[ and E[ for until operators
      if ((two === "A[" || two === "E[")) {
        tokens.push({ type: "op", value: two, pos });
        i += 2;
        continue;
      }
    }

    // Single-character punctuation
    if ("!()],".includes(input[i])) {
      tokens.push({ type: "punct", value: input[i], pos });
      i++;
      continue;
    }

    // 'U' as a punctuation when used as until separator
    if (input[i] === "U" && (i + 1 >= input.length || !/[a-zA-Z0-9_]/.test(input[i + 1]))) {
      // Check if this looks like the 'U' in A[...U...] by checking if we're inside brackets
      // We'll treat standalone 'U' as punctuation; the parser disambiguates
      tokens.push({ type: "punct", value: "U", pos });
      i++;
      continue;
    }

    // Identifiers (proposition names, keywords, temporal operators)
    if (/[a-zA-Z_]/.test(input[i])) {
      let end = i;
      while (end < input.length && /[a-zA-Z0-9_]/.test(input[end])) end++;
      const word = input.slice(i, end);
      tokens.push({ type: "ident", value: word, pos });
      i = end;
      continue;
    }

    return `Unexpected character '${input[i]}' at position ${pos}`;
  }

  return tokens;
}

/**
 * Parses a CTL formula string.
 *
 * Returns the parsed `CTLFormula` or a human-readable error string.
 *
 * Grammar (precedence low to high):
 *   impl   := disj ('->' impl)?        (right-associative)
 *   disj   := conj ('||' conj)*
 *   conj   := unary ('&&' unary)*
 *   unary  := '!' unary | temporal | primary
 *   temporal := ('AX'|'EX'|'AF'|'EF'|'AG'|'EG') unary
 *             | 'A[' impl 'U' impl ']'
 *             | 'E[' impl 'U' impl ']'
 *   primary := 'true' | 'false' | IDENT | '(' impl ')'
 */
export function parseCTL(input: string): CTLFormula | string {
  const tokensOrError = tokenize(input);
  if (typeof tokensOrError === "string") return tokensOrError;
  const tokens = tokensOrError;

  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function advance(): Token {
    return tokens[pos++];
  }

  function expect(type: string, value: string): Token | string {
    const t = peek();
    if (!t) return `Expected '${value}' but reached end of input`;
    if (t.type !== type || t.value !== value) {
      return `Expected '${value}' at position ${t.pos}, got '${t.value}'`;
    }
    return advance();
  }

  function parseImpl(): CTLFormula | string {
    const left = parseDisj();
    if (typeof left === "string") return left;
    if (peek()?.type === "op" && peek()!.value === "->") {
      advance();
      const right = parseImpl(); // right-associative
      if (typeof right === "string") return right;
      return { tag: "implies", left, right };
    }
    return left;
  }

  function parseDisj(): CTLFormula | string {
    let left = parseConj();
    if (typeof left === "string") return left;
    while (peek()?.type === "op" && peek()!.value === "||") {
      advance();
      const right = parseConj();
      if (typeof right === "string") return right;
      left = { tag: "or", left, right };
    }
    return left;
  }

  function parseConj(): CTLFormula | string {
    let left = parseUnary();
    if (typeof left === "string") return left;
    while (peek()?.type === "op" && peek()!.value === "&&") {
      advance();
      const right = parseUnary();
      if (typeof right === "string") return right;
      left = { tag: "and", left, right };
    }
    return left;
  }

  function parseUnary(): CTLFormula | string {
    const t = peek();
    if (!t) return "Unexpected end of input";

    // Negation
    if (t.type === "punct" && t.value === "!") {
      advance();
      const sub = parseUnary();
      if (typeof sub === "string") return sub;
      return { tag: "not", sub };
    }

    // Temporal operators (unary: AX, EX, AF, EF, AG, EG)
    if (t.type === "ident" && KEYWORDS.has(t.value) && t.value !== "true" && t.value !== "false") {
      const op = advance().value as "AX" | "EX" | "AF" | "EF" | "AG" | "EG";
      const sub = parseUnary();
      if (typeof sub === "string") return sub;
      return { tag: op, sub };
    }

    // Until operators: A[φ U ψ] and E[φ U ψ]
    if (t.type === "op" && (t.value === "A[" || t.value === "E[")) {
      const kind = advance().value === "A[" ? "AU" : "EU";
      const left = parseImpl();
      if (typeof left === "string") return left;
      const u = expect("punct", "U");
      if (typeof u === "string") return u;
      const right = parseImpl();
      if (typeof right === "string") return right;
      const close = expect("punct", "]");
      if (typeof close === "string") return close;
      return { tag: kind, left, right };
    }

    return parsePrimary();
  }

  function parsePrimary(): CTLFormula | string {
    const t = peek();
    if (!t) return "Unexpected end of input";

    if (t.type === "ident" && t.value === "true") {
      advance();
      return { tag: "true" };
    }
    if (t.type === "ident" && t.value === "false") {
      advance();
      return { tag: "false" };
    }
    if (t.type === "ident") {
      advance();
      return { tag: "atom", name: t.value };
    }
    if (t.type === "punct" && t.value === "(") {
      advance();
      const inner = parseImpl();
      if (typeof inner === "string") return inner;
      const close = expect("punct", ")");
      if (typeof close === "string") return close;
      return inner;
    }

    return `Unexpected token '${t.value}' at position ${t.pos}`;
  }

  const result = parseImpl();
  if (typeof result === "string") return result;
  if (pos < tokens.length) {
    return `Unexpected token '${tokens[pos].value}' at position ${tokens[pos].pos}`;
  }
  return result;
}
