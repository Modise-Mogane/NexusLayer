"use client";

import { Handle, Position } from "@xyflow/react";

export interface NetworkNodeData {
  label: string;
  nodeType: string;
  operational: boolean;
  onActiveRoute: boolean;
  [key: string]: unknown;
}

const TYPE_STYLES: Record<string, { badge: string; bar: string; glyph: string }> = {
  ship: { badge: "bg-sky-600", bar: "bg-sky-500", glyph: "SHP" },
  base_station: { badge: "bg-emerald-600", bar: "bg-emerald-500", glyph: "BTS" },
  satellite: { badge: "bg-violet-600", bar: "bg-violet-500", glyph: "SAT" },
  gateway: { badge: "bg-amber-600", bar: "bg-amber-500", glyph: "GW" },
  internet: { badge: "bg-slate-600", bar: "bg-slate-500", glyph: "NET" },
};

export default function NetworkNode({ data, selected }: { data: NetworkNodeData; selected?: boolean }) {
  const style = TYPE_STYLES[data.nodeType] ?? TYPE_STYLES.internet;
  const border = !data.operational
    ? "border-red-400"
    : selected
      ? "border-blue-500 ring-2 ring-blue-200"
      : data.onActiveRoute
        ? "border-blue-400 ring-2 ring-blue-100"
        : "border-slate-300";

  return (
    <div className={`w-44 rounded-lg border bg-white shadow-sm ${border} ${data.operational ? "" : "opacity-60"}`}>
      <div className={`h-1.5 rounded-t-lg ${data.operational ? style.bar : "bg-red-400"}`} />
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white ${
            data.operational ? style.badge : "bg-red-500"
          }`}
        >
          {style.glyph}
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-900">{data.label}</div>
          <div className="truncate text-[10px] uppercase tracking-wide text-slate-500">
            {data.operational ? data.nodeType.replace("_", " ") : "unreachable"}
          </div>
        </div>
      </div>
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
    </div>
  );
}
