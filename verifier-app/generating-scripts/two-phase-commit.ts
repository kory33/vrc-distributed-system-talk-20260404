console.log(JSON.stringify(generateModel(2), null, 2));
//                                       ↑ ワーカー数を変えると状態空間が急激に増大する

// NOTE: https://www.typescriptlang.org/play で実行すると、
//       ビジュアライザに食わせられる JSON が生成できます。
//
// 2相コミットプロトコル (2PC) の Kripke 構造。
//
// プロセス構成: コーディネータ 1台 + ワーカー N台
//
// コーディネータの状態:
//   collecting(S)    — 投票収集中。S ⊆ {0,...,N-1} は「yes」投票を受領済みのワーカー集合
//   decided_commit   — コミット決定済み（全ワーカーが yes の場合のみ）
//   decided_abort    — アボート決定済み
//   down             — クラッシュ中
//
// ワーカーの状態:
//   working   — 未投票
//   prepared  — yes 投票済み、決定待ち
//   committed — コミット通知を受信済み
//   aborted   — アボート済み（no 投票、タイムアウト、またはアボート通知受信）
//   down      — クラッシュ中
//
// 受信箱 (ワーカーごと):
//   empty                — 空
//   received_do_commit_msg — コミット指示メッセージを受領済み（ワーカー未処理）
//   received_do_abort_msg  — アボート指示メッセージを受領済み（ワーカー未処理）
//
// 通信モデル:
//   - 投票は原子的（コーディネータの状態変化とワーカーの状態変化が同時に起こる）
//   - 決定通知はコーディネータが受信箱に配置し、ワーカーが個別に受信する
//   - ワーカーがクラッシュすると受信箱がクリアされる（メッセージ喪失）
//
// クラッシュ・復旧:
//   - コーディネータはどの状態からもクラッシュしうる
//   - ワーカーはどの状態からもクラッシュしうる（committed/aborted を含む）
//   - 復旧時、ワーカーはローカル状態ログからクラッシュ前の状態を復元する
//     （ただし受信箱の内容は喪失する）

type KripkeStructureVisualizationJson = {
  kripkeStructure: {
    nodeCount: number;
    transitions: [number, number][];
    valuation: Record<string, number[]>;
  };
  visualizationParams?: {
    colors?: Record<string, string>;
  };
  defaultCTLFormulaToCheck?: string;
};

// ---------------------------------------------------------------------------
// 状態の型と操作
// ---------------------------------------------------------------------------

type GlobalState = {
  /** "collecting_MASK" | "decided_commit" | "decided_abort" | "down" */
  coord: string;
  /** 各ワーカーの状態 ("working" | "prepared" | "committed" | "aborted" | "down") */
  workers: string[];
  /** 各ワーカーの受信箱 ("empty" | "received_do_commit_msg" | "received_do_abort_msg") */
  inboxes: string[];
};

function stateKey(s: GlobalState): string {
  return `${s.coord}|${s.workers.join(",")}|${s.inboxes.join(",")}`;
}

function cloneState(s: GlobalState): GlobalState {
  return { coord: s.coord, workers: [...s.workers], inboxes: [...s.inboxes] };
}

// ---------------------------------------------------------------------------
// 遷移規則
// ---------------------------------------------------------------------------

function successors(s: GlobalState, n: number): GlobalState[] {
  const out: GlobalState[] = [];
  const allBits = (1 << n) - 1;

  const isCollecting = s.coord.startsWith("collecting_");
  const mask = isCollecting ? parseInt(s.coord.split("_")[1]) : -1;

  // --- 投票 (原子的: コーディネータ + ワーカー同時遷移) ---
  if (isCollecting) {
    for (let i = 0; i < n; i++) {
      if (s.workers[i] !== "working") continue;

      // ワーカー i が yes 投票
      if (!(mask & (1 << i))) {
        const t = cloneState(s);
        t.coord = `collecting_${mask | (1 << i)}`;
        t.workers[i] = "prepared";
        out.push(t);
      }

      // ワーカー i が no 投票 / 投票拒否
      {
        const t = cloneState(s);
        t.coord = "decided_abort";
        t.workers[i] = "aborted";
        out.push(t);
      }
    }
  }

  // --- コーディネータがコミット決定（全 yes 受領時） ---
  if (s.coord === `collecting_${allBits}`) {
    const t = cloneState(s);
    t.coord = "decided_commit";
    for (let i = 0; i < n; i++) t.inboxes[i] = "received_do_commit_msg";
    out.push(t);
  }

  // --- コーディネータがアボート通知を受信箱に配置 ---
  if (s.coord === "decided_abort") {
    for (let i = 0; i < n; i++) {
      if (s.inboxes[i] === "empty" && (s.workers[i] === "prepared" || s.workers[i] === "working")) {
        const t = cloneState(s);
        t.inboxes[i] = "received_do_abort_msg";
        out.push(t);
      }
    }
  }

  // --- ワーカーが受信箱からメッセージを受信 ---
  for (let i = 0; i < n; i++) {
    if (s.inboxes[i] === "received_do_commit_msg" && s.workers[i] === "prepared") {
      const t = cloneState(s);
      t.workers[i] = "committed";
      t.inboxes[i] = "empty";
      out.push(t);
    }
    if (s.inboxes[i] === "received_do_abort_msg" && (s.workers[i] === "prepared" || s.workers[i] === "working")) {
      const t = cloneState(s);
      t.workers[i] = "aborted";
      t.inboxes[i] = "empty";
      out.push(t);
    }
  }

  // --- prepared ワーカーのタイムアウト: コーディネータがクラッシュ中かつ受信箱が空のとき、prepared → aborted ---
  // prepared 状態のワーカーはコーディネータの決定を待っているが、
  // コーディネータが到達不能かつ受信箱にメッセージがなければ決定を知る術がなく、最終的にアボートする
  if (s.coord === "down") {
    for (let i = 0; i < n; i++) {
      if (s.workers[i] === "prepared" && s.inboxes[i] === "empty") {
        const t = cloneState(s);
        t.workers[i] = "aborted";
        out.push(t);
      }
    }
  }

  // --- コーディネータのクラッシュ ---
  if (s.coord !== "down") {
    const t = cloneState(s);
    t.coord = "down";
    out.push(t);
  }

  // --- ワーカーのクラッシュ: どの状態からも down へ。受信箱クリア ---
  for (let i = 0; i < n; i++) {
    if (s.workers[i] !== "down") {
      const t = cloneState(s);
      t.workers[i] = "down";
      t.inboxes[i] = "empty";
      out.push(t);
    }
  }

  // --- ワーカーの復旧: down → クラッシュ前の状態 ---
  // ワーカーはローカル状態ログを持つため、クラッシュ前の状態を復元できる。
  // ただしコーディネータの決定（受信箱の内容）は喪失する。
  for (let i = 0; i < n; i++) {
    if (s.workers[i] === "down") {
      // クラッシュ前の状態を復元するために、down 以外の全状態への遷移を生成する。
      // ただし、committed/aborted はコーディネータからの通知に基づく状態であり、
      // 通知自体は受信箱経由で届くため、復旧時に直接これらの状態になることはない。
      for (const restored of ["working", "prepared"] as const) {
        const t = cloneState(s);
        t.workers[i] = restored;
        out.push(t);
      }
    }
  }

  // --- 全遷移が空の場合、自己ループ（Kripke 構造の全域性） ---
  if (out.length === 0) {
    out.push(cloneState(s));
  }

  return out;
}

// ---------------------------------------------------------------------------
// モデル生成
// ---------------------------------------------------------------------------

function generateModel(workerCount: number): KripkeStructureVisualizationJson {
  const n = workerCount;

  // --- 初期状態 ---
  const init: GlobalState = {
    coord: "collecting_0",
    workers: Array.from({ length: n }, () => "working"),
    inboxes: Array.from({ length: n }, () => "empty"),
  };

  // --- BFS ---
  const stateMap = new Map<string, number>(); // key → index
  const states: GlobalState[] = [];
  const transitions: [number, number][] = [];

  const enqueue = (s: GlobalState): number => {
    const k = stateKey(s);
    if (stateMap.has(k)) return stateMap.get(k)!;
    const idx = states.length;
    stateMap.set(k, idx);
    states.push(s);
    return idx;
  };

  enqueue(init);
  const edgeSet = new Set<string>();

  for (let qi = 0; qi < states.length; qi++) {
    const s = states[qi];
    for (const t of successors(s, n)) {
      const ti = enqueue(t);
      const edgeKey = `${qi},${ti}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        transitions.push([qi, ti]);
      }
    }
  }

  // --- 原子命題と付値 ---
  const valuation: Record<string, number[]> = {};

  const propIndices = (pred: (s: GlobalState) => boolean): number[] =>
    states.reduce<number[]>((acc, s, i) => { if (pred(s)) acc.push(i); return acc; }, []);

  // 初期状態
  valuation["init"] = [0]; // BFS の開始点が状態 0

  // コーディネータの状態
  valuation["coord_down"] = propIndices(s => s.coord === "down");

  // ワーカーごとの状態
  for (let i = 0; i < n; i++) {
    const label = `w${i + 1}`;
    valuation[`${label}_committed`] = propIndices(s => s.workers[i] === "committed");
    valuation[`${label}_aborted`] = propIndices(s => s.workers[i] === "aborted");
    valuation[`${label}_prepared`] = propIndices(s => s.workers[i] === "prepared");
    valuation[`${label}_down`] = propIndices(s => s.workers[i] === "down");
  }

  // 受信箱の状態
  for (let i = 0; i < n; i++) {
    const label = `inbox${i + 1}`;
    valuation[`${label}_received_do_commit_msg`] = propIndices(s => s.inboxes[i] === "received_do_commit_msg");
    valuation[`${label}_received_do_abort_msg`] = propIndices(s => s.inboxes[i] === "received_do_abort_msg");
  }

  // --- 色 ---
  const colors: Record<string, string> = {
    coord_down: "#6b7280",
  };

  // ワーカーごとに色相をずらす
  for (let i = 0; i < n; i++) {
    const label = `w${i + 1}`;
    const hueOffset = (i * 137.508) % 360;
    colors[`${label}_committed`] = `hsl(${(140 + hueOffset) % 360}, 70%, 45%)`;
    colors[`${label}_aborted`] = `hsl(${(0 + hueOffset) % 360}, 70%, 50%)`;
    colors[`${label}_prepared`] = `hsl(${(45 + hueOffset) % 360}, 80%, 50%)`;
    colors[`${label}_down`] = `hsl(${(220 + hueOffset) % 360}, 10%, 50%)`;
  }

  return {
    kripkeStructure: {
      nodeCount: states.length,
      transitions,
      valuation,
    },
    visualizationParams: { colors },
    // 安全性: 「初期状態から出発すると、常に w1 committed → w2 not aborted」— このモデルでは偽
    defaultCTLFormulaToCheck: "init -> AG (w1_committed -> !w2_aborted)",
  };
}
