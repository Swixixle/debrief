import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { eduStateColor, type CognitiveNodeProps } from "./cognitiveTypes";
import { LabelWithAlternatives } from "./LabelWithAlternatives";

export type DownTriangleNodeData = CognitiveNodeProps;

function downTrianglePoints(cx: number, cy: number, w: number, h: number): string {
  const bottom = `${cx},${cy + h / 2}`;
  const tl = `${cx - w / 2},${cy - h / 2}`;
  const tr = `${cx + w / 2},${cy - h / 2}`;
  return `${tl} ${tr} ${bottom}`;
}

/** Thin zigzag “crack” from apex toward bottom-left inside the triangle (gap state). */
function gapCrackPath(cx: number, cy: number, w: number, h: number): string {
  const topY = cy - h / 2;
  const blx = cx - w / 2;
  const bly = cy + h / 2;
  const midY = cy;
  return `M ${cx} ${topY} L ${cx - 3} ${topY + h * 0.22} L ${cx + 4} ${midY} L ${cx - 2} ${midY + h * 0.18} L ${blx} ${bly}`;
}

export function DownTriangleNode({ data }: NodeProps<{ data: DownTriangleNodeData }>) {
  const fill = eduStateColor[data.state];
  const w = data.nodeId === "chain-export" ? 54 : 46;
  const h = data.nodeId === "chain-export" ? 48 : 42;
  const cx = 36;
  const cy = 28;
  const gap = data.state === "gap";
  const cyPoly = cy + 4;

  return (
    <div
      className="relative flex flex-col items-center"
      style={{ opacity: Math.max(0.15, data.nodeOpacity) }}
    >
      {data.historyBadgeOrder != null ? (
        <span
          className="absolute z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-900/15 bg-white px-1 text-[10px] font-semibold text-slate-800 shadow-sm"
          style={{ top: -2, right: 10 }}
          aria-hidden
        >
          {data.historyBadgeOrder}
        </span>
      ) : null}
      <Handle type="target" position={Position.Top} className="!opacity-0 !w-2 !h-2" />
      <div
        className={cn("relative", gap && "animate-[edu-gap-pulse-loop_2s_ease-in-out_infinite]")}
        style={{ transformOrigin: "50% 45%" }}
      >
        <svg width={88} height={72} className="overflow-visible">
          <polygon
            points={downTrianglePoints(cx, cyPoly, w, h)}
            fill={fill}
            stroke="rgba(15,23,42,0.25)"
            strokeWidth={1.5}
            className={cn(
              data.gapFlash && "animate-[edu-gap-flash_0.35s_ease-out_1]",
              data.isPulsing && "animate-[edu-node-pulse_0.45s_ease-out_1]",
            )}
          />
          {gap ? (
            <path
              d={gapCrackPath(cx, cyPoly, w, h)}
              fill="none"
              stroke="white"
              strokeWidth={1}
              strokeOpacity={0.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </svg>
        {gap ? (
          <AlertTriangle className="absolute left-1/2 top-3 -translate-x-1/2 w-4 h-4 text-white drop-shadow-md" strokeWidth={2.5} />
        ) : null}
      </div>
      <LabelWithAlternatives
        className="mt-0.5 max-w-[210px]"
        label={data.label}
        sublabel={data.sublabel}
        alternatives={data.alternativeTechnologies}
        labelTextClassName={gap ? "text-red-600" : undefined}
      />
      <Handle type="source" position={Position.Bottom} className="!opacity-0 !w-2 !h-2" />
    </div>
  );
}
