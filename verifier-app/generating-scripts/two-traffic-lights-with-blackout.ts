// NOTE: https://www.typescriptlang.org/play で実行すると、
//       ビジュアライザに食わせられる JSON が生成できます。
//
// 交差点にある2つの信号機の Kripke 構造（停電あり）。
//
// 各信号は 青(green)・黄(amber)・赤(red) のいずれか。
// 停電状態ではいずれも成り立たない。
// 通常時は以下のサイクルを繰り返す:
//
//   (青, 赤) → (黄, 赤) → (赤, 赤)
//     → (赤, 青) → (赤, 黄) → (赤, 赤) → (青, 赤) → ...
//
// どの状態からも停電状態 (消灯, 消灯) へ遷移しうる。
// 停電状態からは、2つの (赤, 赤) 状態のいずれかへ
// 非決定的に復帰する。
//
// (赤, 赤) の状態が2つ存在するのは、次に青になる信号が異なるため。
// この区別は遷移構造に反映されており（後続状態が異なる）、
// 1つの状態に潰してしまうと実際の系には存在しない非決定性が生じる。
//
// 原子命題（通常状態では各信号について互いに排他的かつ網羅的;
//           停電状態ではいずれも成り立たない）:
//   light1_green, light1_amber, light1_red
//   light2_green, light2_amber, light2_red

type KripkeStructureVisualizationJson = {
  kripke_structure: {
    nodeCount: number;
    transitions: [number, number][];
    valuation: Record<string, number[]>;
  };
  visualizationParams?: {
    colors?: Record<string, string>;
    nodePositions?: [number, number][];
  };
};

// --- 状態の割り当て ---
//
// 0: (青, 赤)   — 信号1が通行可
// 1: (黄, 赤)   — 信号1が赤に切り替わる途中
// 2: (赤, 赤)   — 切替中; 次に信号2が青になる
// 3: (赤, 青)   — 信号2が通行可
// 4: (赤, 黄)   — 信号2が赤に切り替わる途中
// 5: (赤, 赤)   — 切替中; 次に信号1が青になる
// 6: (消灯, 消灯) — 停電

const stateCount = 7;

// 通常サイクル: 0 → 1 → 2 → 3 → 4 → 5 → 0
// 停電: 全状態 → 6
// 復帰: 6 → 2, 6 → 5
const normalCycle: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 0],
];
const toBlackout: [number, number][] = [0, 1, 2, 3, 4, 5].map((s) => [s, 6]);
const fromBlackout: [number, number][] = [
  [6, 2],
  [6, 5],
];

const transitions: [number, number][] = [
  ...normalCycle,
  ...toBlackout,
  ...fromBlackout,
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
  kripke_structure: {
    nodeCount: stateCount,
    transitions,
    valuation,
  },
  visualizationParams: {
    colors: {
      light1_green: "#22c55e",
      light1_amber: "#f59e0b",
      light1_red: "#ef4444",
      light2_green: "#16a34a",
      light2_amber: "#d97706",
      light2_red: "#dc2626",
    },
    // 状態0〜5: 正六角形配置（右手座標系; 状態0を右端、反時計回り）
    // 状態6 (停電): 中心
    nodePositions: [
      ...Array.from({ length: 6 }, (_, i) => {
        const angle = (i * Math.PI * 2) / 6;
        return [
          Math.round(100 * Math.cos(angle)),
          Math.round(100 * Math.sin(angle)),
        ] as [number, number];
      }),
      [0, 0], // 状態6: 停電（中心）
    ],
  },
};

console.log(JSON.stringify(result, null, 2));
