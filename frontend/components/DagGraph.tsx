"use client";
import { useMemo } from "react";

export interface DagTask {
  id: string;
  module: string;
  deps?: string[];
}
export interface Dag {
  tasks: DagTask[];
}

interface Positioned extends DagTask {
  level: number;
  row: number;
  x: number;
  y: number;
}

const MODULE_COLOR: Record<string, string> = {
  image_blur: "hsl(199 89% 48%)",
  matmul: "hsl(262 60% 55%)",
  sha_chain: "hsl(175 70% 36%)",
};

const NODE_W = 128;
const NODE_H = 46;
const GAP_X = 72;
const GAP_Y = 24;
const PAD = 20;

/** Bir DAG'i bağımlılık katmanlarına göre (soldan sağa) yerleştirip SVG olarak çizer. */
export function DagGraph({ dag }: { dag: Dag | null }) {
  const { nodes, edges, width, height } = useMemo(() => layout(dag), [dag]);

  if (!dag || nodes.length === 0) {
    return <div className="flex h-48 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">Graf için önce bir plan oluştur.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-md border bg-muted/30 p-2">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="İş akışı grafı" className="min-w-full">
        {edges.map((e, i) => (
          <path key={i} d={e} fill="none" stroke="hsl(215 16% 60%)" strokeWidth={1.5} markerEnd="url(#arrow)" />
        ))}
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="hsl(215 16% 60%)" />
          </marker>
        </defs>
        {nodes.map((n) => (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={8} fill="hsl(var(--card))" stroke={MODULE_COLOR[n.module] ?? "hsl(215 16% 60%)"} strokeWidth={1.75} />
            <circle cx={n.x + 12} cy={n.y + NODE_H / 2} r={4} fill={MODULE_COLOR[n.module] ?? "hsl(215 16% 60%)"} />
            <text x={n.x + 24} y={n.y + 19} className="fill-foreground" fontSize={12} fontWeight={600}>{n.id}</text>
            <text x={n.x + 24} y={n.y + 34} fill="hsl(var(--muted-foreground))" fontSize={10} fontFamily="ui-monospace, monospace">{n.module}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function layout(dag: Dag | null): { nodes: Positioned[]; edges: string[]; width: number; height: number } {
  if (!dag || !dag.tasks?.length) return { nodes: [], edges: [], width: 0, height: 0 };
  const byId = new Map(dag.tasks.map((t) => [t.id, t]));
  const levelCache = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    if (levelCache.has(id)) return levelCache.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const t = byId.get(id);
    const deps = t?.deps ?? [];
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((x) => depth(x, seen)));
    levelCache.set(id, d);
    return d;
  };

  const levels = new Map<number, DagTask[]>();
  for (const t of dag.tasks) {
    const l = depth(t.id);
    const arr = levels.get(l) ?? [];
    arr.push(t);
    levels.set(l, arr);
  }

  const nodes: Positioned[] = [];
  const posById = new Map<string, Positioned>();
  for (const [level, tasks] of [...levels.entries()].sort(([a], [b]) => a - b)) {
    tasks.forEach((t, row) => {
      const p: Positioned = {
        ...t,
        level,
        row,
        x: PAD + level * (NODE_W + GAP_X),
        y: PAD + row * (NODE_H + GAP_Y),
      };
      nodes.push(p);
      posById.set(t.id, p);
    });
  }

  const edges: string[] = [];
  for (const t of dag.tasks) {
    for (const dep of t.deps ?? []) {
      const from = posById.get(dep);
      const to = posById.get(t.id);
      if (!from || !to) continue;
      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;
      edges.push(`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
    }
  }

  const maxLevel = Math.max(...nodes.map((n) => n.level), 0);
  const maxRow = Math.max(...[...levels.values()].map((v) => v.length), 1);
  const width = PAD * 2 + (maxLevel + 1) * NODE_W + maxLevel * GAP_X;
  const height = PAD * 2 + maxRow * NODE_H + (maxRow - 1) * GAP_Y;
  return { nodes, edges, width, height };
}
