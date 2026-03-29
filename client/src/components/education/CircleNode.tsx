import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { eduStateColor, type CognitiveNodeProps } from "./cognitiveTypes";
import { LabelWithAlternatives } from "./LabelWithAlternatives";

export type CircleNodeData = CognitiveNodeProps;

export function CircleNode({ data }: NodeProps<{ data: CircleNodeData }>) {
  const fill = eduStateColor[data.state];
  const r = 28;
  return (
    <div
      className="relative flex flex-col items-center justify-start"
      style={{ opacity: Math.max(0.15, data.nodeOpacity) }}
    >
      {data.historyBadgeOrder != null ? (
        <span
          className="absolute z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-900/15 bg-white px-1 text-[10px] font-semibold text-slate-800 shadow-sm"
          style={{ top: -4, right: 4 }}
          aria-hidden
        >
          {data.historyBadgeOrder}
        </span>
      ) : null}
      <Handle type="target" position={Position.Top} className="!opacity-0 !w-2 !h-2" />
      <svg width={r * 2 + 8} height={r * 2 + 8} className={cn("overflow-visible", data.isPulsing && "animate-[edu-node-pulse_0.5s_ease-out_1]")}>
        <circle
          cx={r + 4}
          cy={r + 4}
          r={r}
          fill={fill}
          stroke="rgba(15,23,42,0.25)"
          strokeWidth={1.5}
        />
      </svg>
      <LabelWithAlternatives
        className="mt-1 max-w-[200px]"
        label={data.label}
        sublabel={data.sublabel}
        alternatives={data.alternativeTechnologies}
      />
      <Handle type="source" position={Position.Bottom} className="!opacity-0 !w-2 !h-2" />
    </div>
  );
}
