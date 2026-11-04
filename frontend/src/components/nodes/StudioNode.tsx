"use client";

import { Handle, Position } from "@xyflow/react";
import DeviceIcon from "@/components/devices/DeviceIcon";

export interface StudioNodeData {
  label: string;
  nodeType: string;
  operational: boolean;
  onActiveRoute: boolean;
  ifaceCount: number;
  [key: string]: unknown;
}

export default function StudioNode({
  data,
  selected,
}: {
  data: StudioNodeData;
  selected?: boolean;
}) {
  const status = !data.operational ? "down" : data.onActiveRoute ? "active" : "ok";
  const dot =
    status === "down" ? "bg-[#ae413a]" : status === "active" ? "bg-[#087f78]" : "bg-[#27845c]";
  return (
    <div
      className={`w-48 rounded-md border bg-[#ffffff] shadow-[0_2px_8px_rgba(36,74,92,0.10)] ${
        selected ? "nx-select-ring border-[#087f78] ring-1 ring-[#087f78]" : "border-[#bed0d9]"
      } ${data.operational ? "" : "opacity-70"}`}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded border ${
            selected ? "border-[#087f78]/60 text-[#087f78]" : "border-[#bed0d9] text-[#486a79]"
          } bg-[#e6f0f3]`}
        >
          <DeviceIcon kind={data.nodeType} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
            <span className="truncate text-xs font-semibold text-[#173b4a]">{data.label}</span>
          </div>
          <div className="truncate font-mono text-[10px] uppercase tracking-wide text-[#5c7680]">
            {data.nodeType.replace(/_/g, " ")}
            {data.ifaceCount > 0 && ` · ${data.ifaceCount} if`}
          </div>
        </div>
      </div>
      <Handle type="target" position={Position.Left} className="!h-3.5 !w-3.5 !border-2 !border-[#bed0d9] !bg-[#087f78]" />
      <Handle type="source" position={Position.Right} className="!h-3.5 !w-3.5 !border-2 !border-[#bed0d9] !bg-[#087f78]" />
    </div>
  );
}
