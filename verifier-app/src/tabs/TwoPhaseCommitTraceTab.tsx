import { useState, useMemo, useCallback } from "react";
import {
  type CounterexampleTrace,
  type TraceStep,
  parseCounterexampleTrace,
} from "../types/counterexampleTrace";

// ---------------------------------------------------------------------------
// 2PC state inference from propositions
// ---------------------------------------------------------------------------

/** Infers a worker's state from the valuation at a trace step. */
function workerState(valuation: Readonly<Record<string, boolean>>, workerLabel: string): string {
  if (valuation[`${workerLabel}_committed`]) return "committed";
  if (valuation[`${workerLabel}_aborted`]) return "aborted";
  if (valuation[`${workerLabel}_prepared`]) return "prepared";
  if (valuation[`${workerLabel}_down`]) return "down";
  return "working";
}

/** Infers the coordinator's observable state from the valuation. */
function coordState(valuation: Readonly<Record<string, boolean>>): string {
  if (valuation["coord_down"]) return "down";
  return "active";
}

/** Infers an inbox's state from the valuation at a trace step. */
function inboxState(valuation: Readonly<Record<string, boolean>>, inboxLabel: string): string {
  if (valuation[`${inboxLabel}_received_do_commit_msg`]) return "received_do_commit_msg";
  if (valuation[`${inboxLabel}_received_do_abort_msg`]) return "received_do_abort_msg";
  return "empty";
}

const STATE_COLORS: Record<string, string> = {
  committed: "#166534",
  aborted: "#991b1b",
  prepared: "#854d0e",
  down: "#4b5563",
  working: "transparent",
  active: "transparent",
  received_do_commit_msg: "#1e3a5f",
  received_do_abort_msg: "#5f1e1e",
  empty: "transparent",
};

const STATE_TEXT_COLORS: Record<string, string> = {
  committed: "#86efac",
  aborted: "#fca5a5",
  prepared: "#fde68a",
  down: "#d1d5db",
  working: "#aaa",
  active: "#aaa",
  received_do_commit_msg: "#93c5fd",
  received_do_abort_msg: "#fca5a5",
  empty: "#aaa",
};

// ---------------------------------------------------------------------------
// Timeline row type
// ---------------------------------------------------------------------------

interface TimelineRow {
  step: number;
  stateIndex: number;
  coord: string;
  workers: Map<number, string>;
  inboxes: Map<number, string>;
  /** "stem", "loop", or undefined for finite traces. */
  section?: "stem" | "loop";
}

/**
 * Returns a flat array of trace steps annotated with their section.
 * - Finite traces: all steps have section undefined.
 * - Lasso traces: stem steps are "stem", loop steps are "loop".
 */
function flattenTraceSteps(
  trace: CounterexampleTrace,
): { step: TraceStep; section?: "stem" | "loop" }[] {
  if (trace.kind === "finite") {
    return trace.path.map((step) => ({ step }));
  }
  return [
    ...trace.stem.map((step) => ({ step, section: "stem" as const })),
    ...trace.loop.map((step) => ({ step, section: "loop" as const })),
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TwoPhaseCommitTraceTab() {
  const [jsonText, setJsonText] = useState("");
  const [trace, setTrace] = useState<CounterexampleTrace | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleParse = useCallback(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    const result = parseCounterexampleTrace(parsed);
    if (typeof result === "string") {
      setError(result);
    } else {
      setTrace(result);
      setError(null);
    }
  }, [jsonText]);

  // Detect worker and inbox IDs from proposition names across all steps
  const { workerIds, inboxIds } = useMemo(() => {
    if (!trace) return { workerIds: [] as number[], inboxIds: [] as number[] };
    const wIds = new Set<number>();
    const iIds = new Set<number>();
    for (const { step } of flattenTraceSteps(trace)) {
      for (const prop of Object.keys(step.valuation)) {
        const wm = prop.match(/^w(\d+)_/);
        if (wm) wIds.add(parseInt(wm[1]));
        const im = prop.match(/^inbox(\d+)_/);
        if (im) iIds.add(parseInt(im[1]));
      }
    }
    return {
      workerIds: [...wIds].sort((a, b) => a - b),
      inboxIds: [...iIds].sort((a, b) => a - b),
    };
  }, [trace]);

  // Build timeline rows
  const rows: TimelineRow[] = useMemo(() => {
    if (!trace) return [];
    return flattenTraceSteps(trace).map(({ step: traceStep, section }, i) => {
      const workers = new Map<number, string>();
      for (const id of workerIds) {
        workers.set(id, workerState(traceStep.valuation, `w${id}`));
      }
      const inboxes = new Map<number, string>();
      for (const id of inboxIds) {
        inboxes.set(id, inboxState(traceStep.valuation, `inbox${id}`));
      }
      return {
        step: i,
        stateIndex: traceStep.stateIndex,
        coord: coordState(traceStep.valuation),
        workers,
        inboxes,
        section,
      };
    });
  }, [trace, workerIds, inboxIds]);

  const cellStyle = (
    state: string,
    changed: boolean,
  ): React.CSSProperties => ({
    padding: "6px 12px",
    background: STATE_COLORS[state] ?? "transparent",
    color: STATE_TEXT_COLORS[state] ?? "#aaa",
    fontFamily: "Martian Mono, monospace",
    fontSize: 13,
    borderBottom: "1px solid #3a3a42",
    borderLeft: changed ? "3px solid #7ec8e3" : "1px solid #3a3a42",
    whiteSpace: "nowrap",
  });

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
      <div
        style={{
          width: 280,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, color: "#555" }}>
          Paste counterexample trace JSON
        </div>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          style={{
            flex: 1,
            fontFamily: "Martian Mono, monospace",
            fontSize: 12,
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
          Visualize
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

      {/* Timeline panel */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          border: "1px solid #ccc",
          borderRadius: 4,
          overflow: "auto",
          background: "#1e1e24",
        }}
      >
        {rows.length > 0 ? (
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid #555" }}>
                <th style={thStyle}>Step</th>
                <th style={thStyle}>State</th>
                <th style={thStyle}>Coordinator</th>
                {workerIds.map((id) => (
                  <th key={`w${id}`} style={thStyle}>
                    Worker {id}
                  </th>
                ))}
                {inboxIds.map((id) => (
                  <th key={`inbox${id}`} style={thStyle}>
                    Inbox {id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const prev = ri > 0 ? rows[ri - 1] : null;
                const coordChanged = prev != null && prev.coord !== row.coord;
                const isLoopStart = row.section === "loop" && prev?.section !== "loop";
                const isLoopRow = row.section === "loop";
                const colCount = 3 + workerIds.length + inboxIds.length;
                const loopRowStyle: React.CSSProperties = isLoopRow
                  ? { borderLeft: "3px solid #c084fc" }
                  : {};
                return (
                  <>
                    {isLoopStart && (
                      <tr key={`loop-sep-${ri}`}>
                        <td
                          colSpan={colCount}
                          style={{
                            padding: "4px 12px",
                            fontSize: 12,
                            color: "#c084fc",
                            background: "rgba(192, 132, 252, 0.08)",
                            borderBottom: "1px solid #3a3a42",
                            fontFamily: "Martian Mono, monospace",
                          }}
                        >
                          loop starts here
                        </td>
                      </tr>
                    )}
                    <tr key={ri} style={loopRowStyle}>
                      <td style={cellStyle("working", false)}>{row.step}</td>
                      <td style={cellStyle("working", false)}>{row.stateIndex}</td>
                      <td style={cellStyle(row.coord, coordChanged)}>
                        {row.coord}
                      </td>
                      {workerIds.map((id) => {
                        const state = row.workers.get(id) ?? "working";
                        const prevState = prev?.workers.get(id) ?? "working";
                        const changed = prev != null && prevState !== state;
                        return (
                          <td key={`w${id}`} style={cellStyle(state, changed)}>
                            {state}
                          </td>
                        );
                      })}
                      {inboxIds.map((id) => {
                        const state = row.inboxes.get(id) ?? "empty";
                        const prevState = prev?.inboxes.get(id) ?? "empty";
                        const changed = prev != null && prevState !== state;
                        return (
                          <td key={`inbox${id}`} style={cellStyle(state, changed)}>
                            {state}
                          </td>
                        );
                      })}
                    </tr>
                  </>
                );
              })}
              {rows.length > 0 && rows[rows.length - 1].section === "loop" && (
                <tr>
                  <td
                    colSpan={3 + workerIds.length + inboxIds.length}
                    style={{
                      padding: "4px 12px",
                      fontSize: 12,
                      color: "#c084fc",
                      background: "rgba(192, 132, 252, 0.08)",
                      borderBottom: "1px solid #3a3a42",
                      fontFamily: "Martian Mono, monospace",
                      borderLeft: "3px solid #c084fc",
                    }}
                  >
                    repeats from loop start
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <div
            style={{
              padding: 24,
              color: "#888",
              textAlign: "center",
              fontSize: 14,
            }}
          >
            Paste a counterexample trace JSON and click Visualize.
          </div>
        )}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  color: "#aaa",
  fontWeight: 600,
  fontSize: 13,
  fontFamily: "Martian Mono, monospace",
  whiteSpace: "nowrap",
};
