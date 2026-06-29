// Build-time port of the app's graph layout engine
// (src/features/commits/graphLayout.ts) — same algorithm, no React.

export interface GraphLane {
  col: number;
  color: string;
  kind: 'line' | 'diag' | 'half-top' | 'half-bot' | 'fork-bot' | 'merge-top';
  to?: number;
}

export interface GraphNode {
  col: number;
  color: string;
  solid?: boolean;
  merge?: boolean;
}

export interface GraphRow {
  lanes: GraphLane[];
  node: GraphNode;
}

export interface MockCommit {
  oid: string;
  parents: string[];
}

interface ActiveLane {
  awaitingOid: string;
  color: string;
}

const PALETTE = [
  'var(--graph-1)',
  'var(--graph-2)',
  'var(--graph-3)',
  'var(--graph-4)',
  'var(--graph-5)',
  'var(--graph-6)',
  'var(--graph-7)',
];

export function layoutGraph(commits: MockCommit[]): GraphRow[] {
  const active: Array<ActiveLane | null> = [];
  const rows: GraphRow[] = [];
  let laneBirthCounter = 0;

  const allocSlot = (): number => {
    const free = active.indexOf(null);
    if (free !== -1) return free;
    active.push(null);
    return active.length - 1;
  };

  const nextColor = (): string => {
    const color = PALETTE[laneBirthCounter % PALETTE.length]!;
    laneBirthCounter++;
    return color;
  };

  for (const commit of commits) {
    const awaiting: number[] = [];
    for (let i = 0; i < active.length; i++) {
      if (active[i]?.awaitingOid === commit.oid) awaiting.push(i);
    }

    let nodeCol: number;
    let nodeColor: string;

    if (awaiting.length === 0) {
      nodeCol = allocSlot();
      nodeColor = nextColor();
    } else {
      nodeCol = awaiting[0]!;
      nodeColor = active[nodeCol]!.color;
    }

    const lanesAtTop: Array<{ col: number; color: string } | null> = active.map(
      (a, i) => (a ? { col: i, color: a.color } : null),
    );
    const collapsingCols = awaiting.slice(1);

    if (commit.parents.length >= 1) {
      active[nodeCol] = { awaitingOid: commit.parents[0]!, color: nodeColor };
    } else {
      active[nodeCol] = null;
    }

    for (const col of collapsingCols) active[col] = null;

    const forkTargets: Array<{ toCol: number; color: string }> = [];
    for (let p = 1; p < commit.parents.length; p++) {
      const parent = commit.parents[p]!;
      const existing = active.findIndex((a) => a?.awaitingOid === parent);
      if (existing !== -1) {
        forkTargets.push({ toCol: existing, color: active[existing]!.color });
      } else {
        const slot = allocSlot();
        const color = nextColor();
        active[slot] = { awaitingOid: parent, color };
        forkTargets.push({ toCol: slot, color });
      }
    }

    const lanes: GraphLane[] = [];
    const width = Math.max(active.length, lanesAtTop.length);

    for (let col = 0; col < width; col++) {
      const top = lanesAtTop[col] ?? null;
      const bot = active[col] ?? null;

      if (col === nodeCol) {
        if (top) lanes.push({ col, color: top.color, kind: 'half-top' });
        if (bot) lanes.push({ col, color: bot.color, kind: 'half-bot' });
        continue;
      }

      if (collapsingCols.includes(col) && top) {
        lanes.push({ col, color: top.color, kind: 'merge-top', to: nodeCol });
        continue;
      }

      if (top && bot) {
        lanes.push({ col, color: top.color, kind: 'line' });
        continue;
      }
    }

    for (const f of forkTargets) {
      if (f.toCol === nodeCol) continue;
      lanes.push({ col: nodeCol, color: f.color, kind: 'fork-bot', to: f.toCol });
    }

    const node: GraphNode = {
      col: nodeCol,
      color: nodeColor,
      solid: commit.parents.length <= 1,
      merge: commit.parents.length >= 2,
    };

    rows.push({ lanes, node });
  }

  return rows;
}
