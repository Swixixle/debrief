import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useRoute } from "wouter";
import dagre from "@dagrejs/dagre";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Position,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CognitiveNode, EvidenceChainModel, HistoryStage, KeyStatus } from "@shared/evidenceChainModel";
import { HistoryDetailPanel } from "@/components/education/HistoryDetailPanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { CircleNode } from "@/components/education/CircleNode";
import { UpTriangleNode } from "@/components/education/UpTriangleNode";
import { DownTriangleNode } from "@/components/education/DownTriangleNode";
import { SquareNode } from "@/components/education/SquareNode";
import { CognitiveEdge } from "@/components/education/CognitiveEdge";
import { eduStateColor, type CognitiveEdgeData } from "@/components/education/cognitiveTypes";
import { KeyHealthPanel } from "@/components/education/KeyHealthPanel";
import { useDebriefApiKey } from "@/contexts/DebriefApiKeyContext";
import { isOpenWeb } from "@/lib/openWeb";
import { Loader2 } from "lucide-react";

const nodeTypes: NodeTypes = {
  cognitiveCircle: CircleNode,
  cognitiveUp: UpTriangleNode,
  cognitiveDown: DownTriangleNode,
  cognitiveSquare: SquareNode,
};

const edgeTypes = { cognitive: CognitiveEdge };

const NODE_REVEAL: Record<string, number> = {
  target: 0,
  analyzer: 200,
  "receipt-creation": 400,
  "chain-link": 750,
  "receipt-stored": 950,
  "chain-export": 1150,
};

const EDGE_START = [0, 200, 400, 600, 750, 950];
const EDGE_END = [200, 400, 600, 750, 950, 1150];

type ReceptionistMode = "explain" | "other-ways" | "suggestions" | "keep-it";

type AlternativeStrategies = {
  simpler: string;
  more_scalable: string;
  why_keep_it: string;
};

function formatBuildTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function shapeToNodeType(shape: CognitiveNode["shape"]): string {
  switch (shape) {
    case "circle":
      return "cognitiveCircle";
    case "up-triangle":
      return "cognitiveUp";
    case "down-triangle":
      return "cognitiveDown";
    default:
      return "cognitiveSquare";
  }
}

function layoutWithDagre(nodes: Node<CognitiveFlowData>[], edges: Edge[]): Node<CognitiveFlowData>[] {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 56, ranksep: 72, marginx: 48, marginy: 56 });
  nodes.forEach((n) => g.setNode(n.id, { width: 220, height: 110 }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom,
      position: { x: pos.x - 110, y: pos.y - 55 },
    };
  });
}

type CognitiveFlowData = {
  cognitive: CognitiveNode;
  label: string;
  sublabel: string;
  state: CognitiveNode["state"];
  criticality: CognitiveNode["criticality"];
  isActive: boolean;
  isPulsing: boolean;
  nodeOpacity: number;
  nodeId: string;
  chainLinkHold?: boolean;
  gapFlash?: boolean;
  alternativeTechnologies: string[];
  historyBadgeOrder?: number;
};

type EducationMode = "pipeline" | "history";

function buildFlowElements(
  model: EvidenceChainModel,
  prog: number,
  walkthroughDone: boolean,
  gapFlash: boolean,
  educationMode: EducationMode,
  historyIntroStep: number,
): { nodes: Node<CognitiveFlowData>[]; edges: Edge[] } {
  const stages = model.historyStages ?? [];
  const historyById = new Map(stages.map((h) => [h.nodeId, h]));
  const sortedPulseIds = [...model.nodes].sort((a, b) => a.pulseOrder - b.pulseOrder).map((n) => n.id);

  const nodesIn: Node<CognitiveFlowData>[] = model.nodes.map((n) => {
    const hist = historyById.get(n.id);
    const label = educationMode === "history" && hist ? hist.stageName : n.label;
    const historyBadgeOrder = educationMode === "history" && hist ? hist.constructionOrder : undefined;
    return {
      id: n.id,
      type: shapeToNodeType(n.shape),
      position: { x: 0, y: 0 },
      data: {
        cognitive: n,
        label,
        sublabel: n.sublabel,
        state: n.state,
        criticality: n.criticality,
        isActive: false,
        isPulsing: false,
        nodeOpacity: 1,
        nodeId: n.id,
        chainLinkHold: false,
        gapFlash: false,
        alternativeTechnologies: n.alternativeTechnologies ?? [],
        historyBadgeOrder,
      },
    };
  });

  const edgesIn: Edge[] = model.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "cognitive",
    data: {
      label: e.label,
      weight: e.weight,
      pulseOrder: e.pulseOrder,
      strokeColor: "var(--edu-gray)",
      animated: false,
      edgeOpacity: 0.6,
    } satisfies CognitiveEdgeData,
  }));

  if (educationMode === "history") {
    const pulseId =
      historyIntroStep >= 0 && historyIntroStep < sortedPulseIds.length
        ? sortedPulseIds[historyIntroStep]
        : null;

    const nodes: Node<CognitiveFlowData>[] = nodesIn.map((node) => ({
      ...node,
      data: {
        ...node.data,
        nodeOpacity: 1,
        chainLinkHold: false,
        gapFlash: false,
        isPulsing: pulseId === node.id,
        isActive: true,
      },
    }));

    const edges: Edge[] = edgesIn.map((edge) => {
      const src = model.nodes.find((n) => n.id === edge.source);
      const stroke = src ? eduStateColor[src.state] : "var(--edu-gray)";
      return {
        ...edge,
        data: {
          ...(edge.data as CognitiveEdgeData),
          strokeColor: stroke,
          animated: false,
          edgeOpacity: 0.6,
        } satisfies CognitiveEdgeData,
      };
    });

    return { nodes: layoutWithDagre(nodes, edges), edges };
  }

  const revealThreshold = (id: string) => NODE_REVEAL[id] ?? 0;
  const chainHold = prog >= 600 && prog < 750 && !walkthroughDone;

  const nodes: Node<CognitiveFlowData>[] = nodesIn.map((node) => {
    const id = node.id;
    const tReveal = revealThreshold(id);
    let opacity = 0.3;
    if (walkthroughDone) opacity = 1;
    else if (prog >= 0) {
      if (id === "chain-link" && chainHold) opacity = 0.3;
      else if (prog >= tReveal) opacity = 1;
      else opacity = 0.3;
    }

    const isPulsing = !walkthroughDone && prog >= tReveal && prog < tReveal + 120 && !(id === "chain-link" && chainHold);

    return {
      ...node,
      data: {
        ...node.data,
        nodeOpacity: opacity,
        chainLinkHold: id === "chain-link" ? chainHold : false,
        gapFlash: id === "receipt-stored" ? gapFlash && walkthroughDone : false,
        isPulsing,
        isActive: walkthroughDone,
      },
    };
  });

  const edges: Edge[] = edgesIn.map((edge, i) => {
    const start = EDGE_START[i] ?? 0;
    const end = EDGE_END[i] ?? 0;
    let eOpacity = 0;
    let animated = false;
    if (walkthroughDone) {
      eOpacity = 0.6;
    } else if (prog >= 0) {
      if (prog >= end) eOpacity = 0.75;
      else if (prog > start) {
        eOpacity = 0.55;
        animated = true;
      } else eOpacity = 0.02;
    }
    const src = model.nodes.find((n) => n.id === edge.source);
    const stroke = src ? eduStateColor[src.state] : "var(--edu-gray)";
    return {
      ...edge,
      data: {
        ...(edge.data as CognitiveEdgeData),
        strokeColor: walkthroughDone ? stroke : stroke,
        animated: !walkthroughDone && animated,
        edgeOpacity: walkthroughDone ? 0.6 : eOpacity,
      } satisfies CognitiveEdgeData,
    };
  });

  return { nodes: layoutWithDagre(nodes, edges), edges };
}

function FlowCanvas({
  model,
  onSelect,
  replayNonce,
  highlightIds,
  educationMode,
}: {
  model: EvidenceChainModel;
  onSelect: (n: CognitiveNode | null) => void;
  replayNonce: number;
  highlightIds: string[] | null;
  educationMode: EducationMode;
}) {
  const { fitView } = useReactFlow();
  const [prog, setProg] = useState(-1);
  const [done, setDone] = useState(false);
  const [gapFlash, setGapFlash] = useState(false);
  const [historyIntroStep, setHistoryIntroStep] = useState(-1);
  const gapFlashTriggered = useRef(false);
  const rafRef = useRef(0);

  useEffect(() => {
    if (educationMode !== "pipeline") return;
    gapFlashTriggered.current = false;
    setDone(false);
    setProg(-1);
    setGapFlash(false);
    const delayMs = 300;
    const totalMs = 1700;
    const start = performance.now();

    const frame = (now: number) => {
      const elapsed = now - start;
      if (elapsed < delayMs) {
        setProg(-1);
      } else {
        const p = Math.min(elapsed - delayMs, totalMs);
        setProg(p);
        const receiptNode = model.nodes.find((x) => x.id === "receipt-stored");
        const isGap = receiptNode?.state === "gap";
        if (!gapFlashTriggered.current && p >= 950 && isGap) {
          gapFlashTriggered.current = true;
          setGapFlash(true);
          window.setTimeout(() => setGapFlash(false), 350);
        }
        if (p >= totalMs) {
          setDone(true);
          setProg(totalMs);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [model, replayNonce, educationMode]);

  useEffect(() => {
    if (educationMode !== "history") {
      setHistoryIntroStep(-1);
      return;
    }
    const sorted = [...model.nodes].sort((a, b) => a.pulseOrder - b.pulseOrder).map((n) => n.id);
    if (sorted.length === 0) {
      setHistoryIntroStep(-1);
      return;
    }
    setHistoryIntroStep(0);
    let step = 0;
    const tick = window.setInterval(() => {
      step += 1;
      if (step >= sorted.length) {
        setHistoryIntroStep(-1);
        clearInterval(tick);
        return;
      }
      setHistoryIntroStep(step);
    }, 600);
    return () => clearInterval(tick);
  }, [educationMode, replayNonce, model.nodes]);

  const { nodes: laidOutNodes, edges: flowEdges } = useMemo(
    () =>
      buildFlowElements(
        model,
        prog,
        done,
        gapFlash,
        educationMode,
        historyIntroStep,
      ),
    [model, prog, done, gapFlash, educationMode, historyIntroStep],
  );

  const { nodes: highlightedNodes, edges: highlightedEdges } = useMemo(() => {
    if (!highlightIds?.length) {
      return { nodes: laidOutNodes, edges: flowEdges };
    }
    const set = new Set(highlightIds);
    const nodes = laidOutNodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        nodeOpacity: set.has(n.id) ? Math.max(n.data.nodeOpacity, 1) : 0.3,
      },
    }));
    const edges = flowEdges.map((e) => {
      const lit = set.has(e.source) || set.has(e.target);
      const d = e.data as CognitiveEdgeData;
      return {
        ...e,
        data: {
          ...d,
          edgeOpacity: lit ? Math.max(d.edgeOpacity, 0.65) : 0.12,
        } satisfies CognitiveEdgeData,
      };
    });
    return { nodes, edges };
  }, [laidOutNodes, flowEdges, highlightIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState(highlightedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(highlightedEdges);

  useEffect(() => {
    setNodes(highlightedNodes);
    setEdges(highlightedEdges);
  }, [highlightedNodes, highlightedEdges, setNodes, setEdges]);

  useEffect(() => {
    const t = window.setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 80);
    return () => clearTimeout(t);
  }, [fitView, model, replayNonce, done, educationMode, historyIntroStep]);

  const onNodeClick = useCallback(
    (_: MouseEvent, node: Node<CognitiveFlowData>) => {
      onSelect(node.data.cognitive);
    },
    [onSelect],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={onNodeClick}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      minZoom={0.4}
      maxZoom={1.4}
      proOptions={{ hideAttribution: true }}
      className="bg-slate-50"
    >
      <Background gap={20} size={1} color="#cbd5e1" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

type TimelineCard = {
  key: string;
  title: string;
  subtitle: string;
  highlightIds: string[];
  badge: string;
};

function BuildTimelineView({
  model,
  showLogicalOnly,
  onLogicalToggle,
  onHighlight,
  activeKey,
}: {
  model: EvidenceChainModel;
  showLogicalOnly: boolean;
  onLogicalToggle: (v: boolean) => void;
  onHighlight: (ids: string[], key: string) => void;
  activeKey: string | null;
}) {
  const gitOk = model.buildHistory.historyAvailable && model.buildHistory.events.length > 0;
  const useGit = gitOk && !showLogicalOnly;

  const cards: TimelineCard[] = useMemo(() => {
    if (useGit) {
      return model.buildHistory.events.map((ev, i) => ({
        key: `git-${ev.commitHash}-${i}`,
        title: ev.inferredMilestone || ev.message,
        subtitle: `${formatBuildTimestamp(ev.timestamp)} · ${ev.filesAdded.length} file(s) added`,
        highlightIds: ev.highlightIds.length ? ev.highlightIds : ["target"],
        badge: "Milestone",
      }));
    }
    return model.logicalDependencyOrder.map((id, i) => {
      const n = model.nodes.find((x) => x.id === id);
      return {
        key: `log-${id}-${i}`,
        title: n?.label ?? id,
        subtitle: n?.sublabel ?? "Build step",
        highlightIds: [id],
        badge: "Step",
      };
    });
  }, [useGit, model]);

  return (
    <div className="h-full w-full overflow-y-auto bg-slate-50/90 px-4 py-10">
      <div className="mx-auto max-w-lg space-y-6">
        {!gitOk ? (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            Git history is limited for this project. Showing logical build order instead.
          </div>
        ) : null}

        <div className="flex flex-col items-stretch gap-0">
          {cards.map((c, idx) => (
            <div key={c.key} className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => onHighlight(c.highlightIds.filter(Boolean), c.key)}
                className={cn(
                  "w-full rounded-xl border bg-white px-4 py-3 text-left shadow-sm transition-shadow",
                  c.highlightIds.length ? "hover:border-teal-300 hover:shadow-md cursor-pointer" : "cursor-default opacity-90",
                  activeKey === c.key ? "ring-2 ring-teal-500 border-teal-300" : "border-slate-200",
                )}
              >
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  {c.badge}
                </span>
                <h3 className="mt-1 text-sm font-semibold text-slate-900">{c.title}</h3>
                <p className="text-xs text-slate-600 mt-0.5">{c.subtitle}</p>
              </button>
              {idx < cards.length - 1 ? (
                <div className="py-2 text-slate-400 text-center text-sm select-none" aria-hidden>
                  ↓
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <Switch
            id="logical-order"
            checked={showLogicalOnly}
            disabled={!gitOk}
            onCheckedChange={(v) => onLogicalToggle(Boolean(v))}
          />
          <label htmlFor="logical-order" className="text-sm text-slate-700 cursor-pointer">
            Show logical order instead
          </label>
        </div>
      </div>
    </div>
  );
}

function ShapeHint({ shape }: { shape: CognitiveNode["shape"] }) {
  if (shape === "circle") return <span className="text-lg" aria-hidden>◯</span>;
  if (shape === "up-triangle") return <span className="text-lg" aria-hidden>▲</span>;
  if (shape === "down-triangle") return <span className="text-lg" aria-hidden>▼</span>;
  return <span className="text-lg" aria-hidden>◻</span>;
}

export default function EvidenceChainPage() {
  const [, params] = useRoute("/education/:runId/chain");
  const runId = parseInt(params?.runId || "", 10);
  const { apiKey } = useDebriefApiKey();
  const [model, setModel] = useState<EvidenceChainModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CognitiveNode | null>(null);
  const [replayNonce, setReplayNonce] = useState(0);
  const [canvasView, setCanvasView] = useState<"works" | "built">("works");
  const [timelineHighlightIds, setTimelineHighlightIds] = useState<string[] | null>(null);
  const [timelineCardKey, setTimelineCardKey] = useState<string | null>(null);
  const [showLogicalOnly, setShowLogicalOnly] = useState(false);
  const [educationMode, setEducationMode] = useState<EducationMode>("pipeline");

  useEffect(() => {
    if (!runId || isNaN(runId)) {
      setError("Invalid run");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const headers: Record<string, string> = {};
        if (apiKey) headers["X-Api-Key"] = apiKey;
        const res = await fetch(`/api/runs/${runId}/education/chain`, { headers });
        if (!cancelled && res.status === 401) {
          setError("Invalid API key");
          setLoading(false);
          return;
        }
        if (!cancelled && !res.ok) {
          setError(res.status === 404 ? "Run not found" : "Failed to load education model");
          setLoading(false);
          return;
        }
        const data = (await res.json()) as EvidenceChainModel;
        if (!cancelled) {
          setModel(data);
          setSelected(null);
        }
      } catch {
        if (!cancelled) setError("Network error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, apiKey]);

  useEffect(() => {
    if (!model) return;
    setShowLogicalOnly(!model.buildHistory.historyAvailable);
    setTimelineHighlightIds(null);
    setTimelineCardKey(null);
  }, [model]);

  const exportChain = useCallback(async () => {
    if (!model?.chainTargetId || !apiKey) return;
    const res = await fetch(`/api/targets/${model.chainTargetId}/chain/export`, {
      headers: { "X-Api-Key": apiKey },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debrief-chain-export-${model.chainTargetId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [model, apiKey]);

  if (!apiKey && !isOpenWeb) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-slate-600 mb-4">
            Add your API key from Analyze (home), or use an open session, to view how this debrief was produced.
          </p>
          <Link href="/">
            <Button>Go home</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-teal-600" />
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-red-600">{error || "Unknown error"}</p>
        <Link href="/projects">
          <Button variant="outline">Back to library</Button>
        </Link>
      </div>
    );
  }

  const statusBadge =
    model.chainStatus === "intact" ? (
      <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 px-3 py-1 text-xs font-semibold border border-emerald-200">
        Chain Intact
      </span>
    ) : model.chainStatus === "partial" ? (
      <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 px-3 py-1 text-xs font-semibold border border-amber-200">
        Partial chain
      </span>
    ) : (
      <span className="inline-flex items-center rounded-full bg-red-100 text-red-800 px-3 py-1 text-xs font-semibold border border-red-200">
        Chain Broken
      </span>
    );

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-100">
      <div className="flex-[7] min-h-0 relative">
        <div className="absolute top-3 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3">
            <Link href={`/projects/${model.projectId}?runId=${model.runId}`}>
              <Button variant="ghost" size="sm" className="text-slate-600">
                ← Report
              </Button>
            </Link>
            <h1 className="text-sm font-semibold text-slate-900">{model.targetName}</h1>
            {statusBadge}
            <div
              className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs shadow-sm"
              role="tablist"
              aria-label="Evidence view"
            >
              <button
                type="button"
                role="tab"
                aria-selected={canvasView === "works"}
                className={cn(
                  "rounded px-3 py-1.5 font-medium transition-colors",
                  canvasView === "works" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900",
                )}
                onClick={() => setCanvasView("works")}
              >
                How It Works
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={canvasView === "built"}
                className={cn(
                  "rounded px-3 py-1.5 font-medium transition-colors",
                  canvasView === "built" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900",
                )}
                onClick={() => setCanvasView("built")}
              >
                How It Was Built
              </button>
            </div>
          </div>
          <div className="pointer-events-auto flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setReplayNonce((n) => n + 1)}>
              Replay walkthrough
            </Button>
            <Button type="button" size="sm" disabled={!model.chainTargetId} onClick={() => void exportChain()}>
              Export chain
            </Button>
          </div>
        </div>
        <div className="h-full w-full pt-14 flex flex-col min-h-0">
          {canvasView === "works" ? (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 0,
                  border: "0.5px solid var(--color-border-secondary)",
                  borderRadius: "var(--border-radius-md)",
                  overflow: "hidden",
                  width: "fit-content",
                  margin: "12px 16px",
                }}
              >
                {(["pipeline", "history"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setEducationMode(mode);
                      setSelected(null);
                    }}
                    style={{
                      padding: "6px 16px",
                      fontSize: 12,
                      fontWeight: educationMode === mode ? 500 : 400,
                      background:
                        educationMode === mode
                          ? "var(--color-text-primary)"
                          : "var(--color-background-primary)",
                      color:
                        educationMode === mode
                          ? "var(--color-background-primary)"
                          : "var(--color-text-secondary)",
                      border: "none",
                      cursor: "pointer",
                      transition: "all .15s",
                    }}
                  >
                    {mode === "pipeline" ? "What it does" : "How it grew"}
                  </button>
                ))}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-text-tertiary)",
                  padding: "0 16px 8px",
                  lineHeight: 1.5,
                }}
              >
                {educationMode === "pipeline"
                  ? "What each part of the system does and how it connects to the next."
                  : "The order in which these pieces had to exist — and why complexity accumulates the way it does."}
              </div>
              <div className="flex-1 min-h-0 relative">
                <FlowCanvasOrProvider
                  key={`${replayNonce}-${educationMode}`}
                  model={model}
                  onSelect={setSelected}
                  replayNonce={replayNonce}
                  highlightIds={timelineHighlightIds}
                  educationMode={educationMode}
                />
              </div>
            </>
          ) : (
            <BuildTimelineView
              model={model}
              showLogicalOnly={showLogicalOnly}
              onLogicalToggle={setShowLogicalOnly}
              onHighlight={(ids, key) => {
                setTimelineHighlightIds(ids.length ? ids : null);
                setTimelineCardKey(key);
              }}
              activeKey={timelineCardKey}
            />
          )}
        </div>
      </div>

      <DetailPanel
        selected={selected}
        runId={model.runId}
        apiKey={apiKey}
        keyStatuses={model.keyStatuses}
        educationMode={educationMode}
        historyStages={model.historyStages ?? []}
      />
    </div>
  );
}

function FlowCanvasOrProvider(props: {
  model: EvidenceChainModel;
  onSelect: (n: CognitiveNode | null) => void;
  replayNonce: number;
  highlightIds: string[] | null;
  educationMode: EducationMode;
}) {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
}

function receptionNodeContext(n: CognitiveNode) {
  return {
    label: n.label,
    shape: n.shape,
    layer: n.layer,
    state: n.state,
    criticality: n.criticality,
    role: n.role,
    technology: n.technology,
    anomalies: n.anomalies ?? [],
  };
}

function DetailPanel({
  selected,
  runId,
  apiKey,
  keyStatuses,
  educationMode,
  historyStages,
}: {
  selected: CognitiveNode | null;
  runId: string;
  apiKey: string | null;
  keyStatuses: KeyStatus[];
  educationMode: EducationMode;
  historyStages: HistoryStage[];
}) {
  const historyStageForSelection =
    educationMode === "history" && selected
      ? (historyStages.find((s) => s.nodeId === selected.id) ?? null)
      : null;
  const [recMode, setRecMode] = useState<ReceptionistMode>("explain");
  const [recTexts, setRecTexts] = useState<Partial<Record<ReceptionistMode, string>>>({});
  const [recLoading, setRecLoading] = useState<ReceptionistMode | null>(null);
  const [recErr, setRecErr] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<AlternativeStrategies | null>(null);
  const [strategiesLoading, setStrategiesLoading] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setRecMode("explain");
    setRecTexts({});
    setRecErr(null);
    setStrategies(null);
  }, [selected?.id]);

  useEffect(() => {
    setRecErr(null);
  }, [recMode]);

  const canReceptionist = Boolean(apiKey) || isOpenWeb;

  useEffect(() => {
    if (!selected || !canReceptionist || educationMode === "history") return;
    let cancelled = false;
    setStrategiesLoading(true);
    (async () => {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) headers["X-Api-Key"] = apiKey;
        const res = await fetch("/api/education/receptionist", {
          method: "POST",
          headers,
          body: JSON.stringify({
            nodeId: selected.id,
            mode: "other-ways",
            nodeContext: receptionNodeContext(selected),
            runId,
          }),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { strategies?: AlternativeStrategies };
        if (!cancelled && data.strategies) setStrategies(data.strategies);
      } catch {
        /* footer optional */
      } finally {
        if (!cancelled) setStrategiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.id, runId, canReceptionist, apiKey, educationMode]);

  const recTextsRef = useRef(recTexts);
  recTextsRef.current = recTexts;

  useEffect(() => {
    if (!selected || !canReceptionist || educationMode === "history") return;
    const mode = recMode;
    if (recTextsRef.current[mode]) return;

    let cancelled = false;
    setRecLoading(mode);
    setRecErr(null);
    (async () => {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) headers["X-Api-Key"] = apiKey;
        const res = await fetch("/api/education/receptionist", {
          method: "POST",
          headers,
          body: JSON.stringify({
            nodeId: selected.id,
            mode,
            nodeContext: receptionNodeContext(selected),
            runId,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setRecErr(err.error || "Could not load explanation");
          return;
        }
        const data = (await res.json()) as { text?: string; strategies?: AlternativeStrategies };
        if (data.text) {
          setRecTexts((prev) => ({ ...prev, [mode]: data.text }));
        }
        if (mode === "other-ways" && data.strategies) {
          setStrategies(data.strategies);
        }
      } catch {
        if (!cancelled) setRecErr("Network error");
      } finally {
        if (!cancelled) setRecLoading(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.id, recMode, runId, canReceptionist, apiKey, educationMode]);

  return (
    <div className="flex-[3] min-h-[260px] max-h-[380px] border-t border-slate-200 bg-white shadow-[0_-4px_24px_rgba(15,23,42,0.06)] flex flex-col">
      {!selected && educationMode === "history" ? (
        <div className="flex-1 overflow-y-auto">
          <HistoryDetailPanel stage={null} totalStages={historyStages.length || 6} />
        </div>
      ) : !selected ? (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-base px-6 text-center">
          Click any component to understand what it does
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 md:p-6 overflow-y-auto">
          <div className="md:col-span-3 space-y-2 min-w-0">
            <div className="flex items-center gap-2 text-slate-900 font-semibold">
              <ShapeHint shape={selected.shape} />
              <span>
                {educationMode === "history" && historyStageForSelection
                  ? historyStageForSelection.stageName
                  : selected.label}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {selected.shape === "circle"
                ? "Human / Interface"
                : selected.shape === "up-triangle"
                  ? "Process / Action"
                  : selected.shape === "down-triangle"
                    ? "Storage / Memory"
                    : "Infrastructure"}{" "}
              · {selected.criticality === "essential" ? "Essential" : selected.criticality}
            </p>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{selected.detailWhat}</p>
          </div>

          <div className="md:col-span-6 border-t md:border-t-0 md:border-l border-slate-200 pt-3 md:pt-0 md:pl-4 min-w-0 flex flex-col gap-3">
            {educationMode === "history" ? (
              <HistoryDetailPanel
                stage={historyStageForSelection}
                totalStages={historyStages.length || 6}
              />
            ) : !canReceptionist ? (
              <p className="text-sm text-amber-800">Add an API key from Analyze, or use an open session, to use the guide.</p>
            ) : (
              <>
                <Tabs value={recMode} onValueChange={(v) => setRecMode(v as ReceptionistMode)}>
                  <TabsList className="flex flex-wrap h-auto gap-1 bg-slate-100 p-1 justify-start">
                    <TabsTrigger value="explain" className="text-xs px-2 py-1">
                      Explain
                    </TabsTrigger>
                    <TabsTrigger value="other-ways" className="text-xs px-2 py-1">
                      Other Ways
                    </TabsTrigger>
                    <TabsTrigger value="suggestions" className="text-xs px-2 py-1">
                      Suggestions
                    </TabsTrigger>
                    <TabsTrigger value="keep-it" className="text-xs px-2 py-1">
                      Keep It
                    </TabsTrigger>
                  </TabsList>
                  {(["explain", "other-ways", "suggestions", "keep-it"] as const).map((m) => (
                    <TabsContent key={m} value={m} className="mt-2">
                      {recLoading === m ? (
                        <div
                          className="h-0.5 w-full rounded-full bg-slate-200 overflow-hidden mt-1"
                          aria-hidden
                        >
                          <div
                            className="h-full w-full rounded-full bg-slate-400"
                            style={{ animation: "edu-reception-line 1.1s ease-in-out infinite" }}
                          />
                        </div>
                      ) : null}
                      {recErr && recMode === m ? <p className="text-sm text-red-600 mt-2">{recErr}</p> : null}
                      <div
                        className={cn(
                          "text-sm text-slate-800 leading-relaxed mt-2",
                          m === "explain" && "whitespace-pre-wrap",
                          m === "other-ways" && "whitespace-pre-wrap",
                        )}
                      >
                        {recTexts[m] ?? (recLoading === m ? "" : "…")}
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>

                <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                  <p className="text-xs font-semibold text-slate-900">Other ways this could have been built</p>
                  {strategiesLoading && !strategies ? (
                    <div
                      className="h-0.5 max-w-xs rounded-full bg-slate-200 overflow-hidden"
                      aria-hidden
                    >
                      <div
                        className="h-full w-full rounded-full bg-slate-400"
                        style={{ animation: "edu-reception-line 1.1s ease-in-out infinite" }}
                      />
                    </div>
                  ) : null}
                  {strategies ? (
                    <div className="text-xs text-slate-700 space-y-2">
                      <p>
                        <span className="font-medium text-slate-900">Simpler:</span> {strategies.simpler}
                      </p>
                      <p>
                        <span className="font-medium text-slate-900">More scalable:</span> {strategies.more_scalable}
                      </p>
                      <p>
                        <span className="font-medium text-slate-900">Why keep it:</span> {strategies.why_keep_it}
                      </p>
                    </div>
                  ) : !strategiesLoading ? (
                    <p className="text-xs text-slate-500">Alternatives summary loads from the guide.</p>
                  ) : null}
                </div>
              </>
            )}
          </div>

          <div className="md:col-span-3 border-t md:border-t-0 md:border-l border-slate-200 pt-3 md:pt-0 md:pl-4 min-w-0">
            <Collapsible defaultOpen={false}>
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 [&[data-state=open]>svg]:rotate-180">
                Go deeper
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-3 text-xs text-slate-700">
                <div>
                  <p className="font-semibold text-slate-900 mb-1">How this connects</p>
                  <ul className="space-y-1">
                    {selected.detailConnections
                      .filter((c) => c.direction === "from")
                      .map((c, i) => (
                        <li key={`f-${i}`}>Receives from {c.label}.</li>
                      ))}
                    {selected.detailConnections
                      .filter((c) => c.direction === "to")
                      .map((c, i) => (
                        <li key={`t-${i}`}>Sends to {c.label}.</li>
                      ))}
                    {selected.detailConnections.length === 0 ? <li className="text-slate-400">No linked steps.</li> : null}
                  </ul>
                </div>
                <div>
                  <p className="font-semibold text-slate-900 mb-1">In your code</p>
                  <p className="text-slate-600 leading-snug">
                    This lives in <span className="font-mono text-[11px] text-slate-800">{selected.fileRef || "—"}</span>
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
            <div className="mt-4 text-xs text-slate-700 leading-relaxed whitespace-pre-line border-t border-slate-100 pt-3">
              <p className="font-medium text-slate-900 mb-1">What to watch</p>
              {selected.detailWatchFor}
            </div>
          </div>
        </div>
      )}
      {keyStatuses.length > 0 ? <KeyHealthPanel keys={keyStatuses} /> : null}
    </div>
  );
}
