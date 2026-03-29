import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { eduStateColor, type CognitiveNodeProps } from "./cognitiveTypes";
import { LabelWithAlternatives } from "./LabelWithAlternatives";

/** Reserved for future infrastructure nodes (queues, workers). */
export type SquareNodeData = CognitiveNodeProps;

export function SquareNode({ data }: NodeProps<{ data: SquareNodeData }>) {
  const fill = eduStateColor[data.state];
  return (
    <div className="relative flex flex-col items-center" style={{ opacity: Math.max(0.15, data.nodeOpacity) }}>
      {data.historyBadgeOrder != null ? (
        <span
          className="absolute z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-900/15 bg-white px-1 text-[10px] font-semibold text-slate-800 shadow-sm"
          style={{ top: -4, right: 8 }}
          aria-hidden
        >
          {data.historyBadgeOrder}
        </span>
      ) : null}
      <Handle type="target" position={Position.Top} className="!opacity-0 !w-2 !h-2" />
      <div
        className={cn(
          "w-14 h-14 rounded-lg border border-slate-900/20 shadow-sm flex items-center justify-center",
          data.isPulsing && "animate-[edu-node-pulse_0.45s_ease-out_1]",
        )}
        style={{ background: fill }}
      />
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
