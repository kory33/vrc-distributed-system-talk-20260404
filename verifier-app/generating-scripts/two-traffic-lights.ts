// NOTE: https://www.typescriptlang.org/play で実行すると、
//       ビジュアライザに食わせられる JSON が生成できます。
//
// 交差点にある2つの信号機の Kripke 構造。
//
// 各信号は 青(green)・黄(amber)・赤(red) のいずれか。以下のサイクルを繰り返す:
//
//   (青, 赤) → (黄, 赤) → (赤, 赤)
//     → (赤, 青) → (赤, 黄) → (赤, 赤) → (青, 赤) → ...
//
// (赤, 赤) の状態が2つ存在するのは、次に青になる信号が異なるため。
// この区別は遷移構造に反映されており（後続状態が異なる）、
// 1つの状態に潰してしまうと実際の系には存在しない非決定性が生じる。
//
// 原子命題（各信号について互いに排他的かつ網羅的）:
//   light1_green, light1_amber, light1_red
//   light2_green, light2_amber, light2_red

type KripkeStructureVisualizationJson = {
  kripkeStructure: {
    nodeCount: number;
    transitions: [number, number][];
    valuation: Record<string, number[]>;
  };
  visualizationParams?: {
    colors?: Record<string, string>;
    nodePositions?: [number, number][];
  };
  defaultCTLFormulaToCheck?: string;
};

// --- 状態の割り当て ---
//
// 0: (青, 赤)   — 信号1が通行可
// 1: (黄, 赤)   — 信号1が赤に切り替わる途中
// 2: (赤, 赤)   — 切替中; 次に信号2が青になる
// 3: (赤, 青)   — 信号2が通行可
// 4: (赤, 黄)   — 信号2が赤に切り替わる途中
// 5: (赤, 赤)   — 切替中; 次に信号1が青になる

const stateCount = 6;

const transitions: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 0],
];

const valuation: Record<string, number[]> = {
  light1_green: [0],
  light1_amber: [1],
  light1_red: [2, 3, 4, 5],
  light2_green: [3],
  light2_amber: [4],
  light2_red: [0, 1, 2, 5],
};

const result: KripkeStructureVisualizationJson = {
  kripkeStructure: {
    nodeCount: stateCount,
    transitions,
    valuation,
  },
  defaultCTLFormulaToCheck: "AF light1_green",
  visualizationParams: {
    colors: {
      light1_green: "#22c55e",
      light1_amber: "#f59e0b",
      light1_red: "#ef4444",
      light2_green: "#16a34a",
      light2_amber: "#d97706",
      light2_red: "#dc2626",
    },
    // 正六角形配置（右手座標系; 状態0を右端、反時計回り）
    // 半径 100 の正六角形の頂点
    nodePositions: Array.from({ length: 6 }, (_, i) => {
      const angle = (i * Math.PI * 2) / 6;
      return [
        Math.round(100 * Math.cos(angle)),
        Math.round(100 * Math.sin(angle)),
      ] as [number, number];
    }),
  },
};

console.log(JSON.stringify(result, null, 2));
