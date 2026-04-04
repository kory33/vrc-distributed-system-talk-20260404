import { useState } from "react";
import { CTLModelCheckerTab } from "./tabs/CTLModelCheckerTab";
import { TwoPhaseCommitTraceTab } from "./tabs/TwoPhaseCommitTraceTab";
import "./App.css";

const TABS = [
  {
    id: "ctl-model-checker",
    label: "CTL Model Checker",
    render: () => <CTLModelCheckerTab />,
  },
  {
    id: "2pc-trace",
    label: "2PC Trace Visualizer",
    render: () => <TwoPhaseCommitTraceTab />,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Application shell. The active tab determines which experiment view is shown. */
export function App() {
  const [activeTabId, setActiveTabId] = useState<TabId>("ctl-model-checker");
  const activeTab = TABS.find((tab) => tab.id === activeTabId)!;

  return (
    <div className="app">
      <nav className="tab-bar">
        <div role="tablist" aria-label="Application views">
          {TABS.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                className={`tab-button ${isActive ? "active" : ""}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
      <main
        id={`panel-${activeTab.id}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab.id}`}
        className="tab-content"
      >
        {activeTab.render()}
      </main>
    </div>
  );
}
