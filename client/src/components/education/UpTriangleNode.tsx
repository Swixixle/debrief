import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { eduStateColor, type CognitiveNodeProps } from "./cognitiveTypes";
import { LabelWithAlternatives } from "./LabelWithAlternatives";

export type UpTriangleNodeData = CognitiveNodeProps;

function upTrianglePoints(cx: number, cy: number, w: number, h: number): string {
  const top = `${cx},${cy - h / 2}`;
  const bl = `${cx - w / 2},${cy + h / 2}`;
  const br = `${cx + w / 2},${cy + h / 2}`;
  return `${top} ${br} ${bl}`;
}

export function UpTriangleNode({ data }: NodeProps<{ data: UpTriangleNodeData }>) {
  const fill = data.chainLinkHold ? "var(--edu-gray)" : eduStateColor[data.state];
  const large =
    data.nodeId === "receipt-creation" || data.nodeId === "chain-link" || data.criticality === "essential";
  const w = large ? 52 : 44;
  const h = large ? 46 : 40;
  const cx = 36;
  const cy = 32;
  const ring =
    data.nodeId === "chain-link" && !data.chainLinkHold ? (
      <circle
        cx={cx}
        cy={cy + 4}
        r={w / 2 + 10}
        fill="none"
        stroke={data.state === "broken" ? "var(--edu-red)" : "var(--edu-green)"}
        strokeWidth={2}
        className={cn(
          data.state === "broken" ? "animate-[edu-ring-pulse-red_1.4s_ease-out_1]" : "animate-[edu-ring-pulse-green_1.4s_ease-out_1]",
        )}
        opacity={0.55}
      />
    ) : null;

  return (
    <div
      className="relative flex flex-col items-center"
      style={{ opacity: Math.max(0.15, data.nodeOpacity) }}
      title={
        data.nodeId === "chain-link"
          ? "This proves no one tampered with the record between snapshots."
          : undefined
      }
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
      <svg width={88} height={72} className="overflow-visible">
        {ring}
        <polygon
          points={upTrianglePoints(cx, cy + 4, w, h)}
          fill={fill}
          stroke="rgba(15,23,42,0.25)"
          strokeWidth={1.5}
          className={cn(data.isPulsing && "animate-[edu-node-pulse_0.45s_ease-out_1]")}
        />
      </svg>
      <LabelWithAlternatives
        className="mt-0.5 max-w-[200px]"
        label={data.label}
        sublabel={data.sublabel}
        alternatives={data.alternativeTechnologies}
      />
      <Handle type="source" position={Position.Bottom} className="!opacity-0 !w-2 !h-2" />
    </div>
  );
}
