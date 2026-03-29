import type { NodeState } from "@shared/evidenceChainModel";

export interface CognitiveNodeProps {
  label: string;
  sublabel: string;
  state: NodeState;
  criticality: "essential" | "important" | "optional";
  isActive: boolean;
  isPulsing: boolean;
  /** 0–1 node opacity during walkthrough */
  nodeOpacity: number;
  nodeId: string;
  /** Chain link: in the 600–750ms hold, still dim */
  chainLinkHold?: boolean;
  /** Receipt stored gap: one-shot flash */
  gapFlash?: boolean;
  /** Hover popover (industry alternatives); max 3 shown in UI */
  alternativeTechnologies: string[];
  /** “How it grew” mode: construction-order badge on the shape */
  historyBadgeOrder?: number;
}

export const eduStateColor: Record<NodeState, string> = {
  clean: "var(--edu-green)",
  anomaly: "var(--edu-yellow)",
  broken: "var(--edu-red)",
  gap: "var(--edu-red)",
  idle: "var(--edu-gray)",
  healthy: "var(--edu-blue)",
  exposed: "var(--edu-exposed)",
};

export type CognitiveEdgeData = {
  label: string;
  weight: "thick" | "medium" | "thin-dashed";
  pulseOrder: number;
  strokeColor: string;
  animated: boolean;
  edgeOpacity: number;
};
