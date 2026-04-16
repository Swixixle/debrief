/**
 * Evidence chain walkthrough — cognitive model for the `/education/:runId/chain` UI (shared by API + unit tests).
 */

import { computeLogicalDependencyOrder } from "./educationTopology";

export type NodeState =
  | "clean"
  | "anomaly"
  | "broken"
  | "gap"
  | "idle"
  | "healthy"
  | "exposed";

export interface KeyStatus {
  name: string;
  displayName: string;
  status: "set" | "auto" | "missing";
  role: string;
  consequence: string;
  howToStore: string;
  rotationSteps: string[];
}
export type NodeShape = "circle" | "up-triangle" | "down-triangle" | "square";
export type NodeLayer = "sky" | "engine" | "foundation";

export interface BuildEvent {
  commitHash: string;
  timestamp: string;
  message: string;
  filesAdded: string[];
  inferredMilestone: string;
  /** Education map: node ids to highlight for this milestone (server-filled). */
  highlightIds: string[];
}

export interface BuildHistoryPayload {
  events: BuildEvent[];
  historyAvailable: boolean;
}

export interface CognitiveNode {
  id: string;
  shape: NodeShape;
  layer: NodeLayer;
  label: string;
  sublabel: string;
  state: NodeState;
  criticality: "essential" | "important" | "optional";
  detailWhat: string;
  detailConnections: { direction: "from" | "to"; label: string; nodeId: string }[];
  detailWatchFor: string;
  pulseOrder: number;
  /** Plain role sentence for the Receptionist */
  role: string;
  /** Concrete tech stack tie-in for this app shape */
  technology: string;
  /** Strings from CVs, anomaly reasons, gap notes — for Suggestions mode */
  anomalies: string[];
  /** Human-readable code location or “where this lives” string */
  fileRef: string;
  /** Hover popover: other industry approaches (max 3 in UI) */
  alternativeTechnologies: string[];
}

export interface CognitiveEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  weight: "thick" | "medium" | "thin-dashed";
  pulseOrder: number;
}

export interface HistoryStage {
  nodeId: string;
  constructionOrder: number;
  stageName: string;
  stageRole: string;
  whyFirst: string;
  whatBreaksWithout: string;
  organismMetaphor: string;
}

const EDUCATION_HISTORY_STAGES: HistoryStage[] = [
  {
    nodeId: "target",
    constructionOrder: 1,
    stageName: "The question",
    stageRole:
      "Before any code existed, someone decided what this system measures.",
    whyFirst:
      'You cannot build an engine until you know what it processes. The repo URL is the question the whole system was built to answer: "what is in this codebase right now?" Everything else exists to serve that question.',
    whatBreaksWithout:
      "Without a clear input definition, the analyzer has nothing to normalize against. Every downstream step — receipts, chains, alerts — would have no anchor.",
    organismMetaphor: "The first cell. Just a membrane and a question about the environment outside it.",
  },
  {
    nodeId: "analyzer",
    constructionOrder: 2,
    stageName: "The first engine",
    stageRole: "The first thing that actually ran. No interface, no database, no chain. Just input → output.",
    whyFirst:
      "The analyzer existed before the API, before the UI, before anything else. You could run it with a file path and it produced JSON. That is the whole system at this stage — a script that reads code and writes findings.",
    whatBreaksWithout:
      "Everything. The analyzer is the only part that actually reads the codebase. All receipts, all chains, all education content are downstream of what it finds.",
    organismMetaphor: "Metabolism. The core chemical reaction that everything else will eventually depend on.",
  },
  {
    nodeId: "receipt-creation",
    constructionOrder: 3,
    stageName: "The first memory",
    stageRole: "Once the engine works, you need to remember what it found. The receipt is the moment output becomes record.",
    whyFirst:
      "A system that runs but does not remember is a calculator. The receipt is what turns Debrief from a scanner into a record-keeper. It adds no new analysis capability — it adds persistence and proof.",
    whatBreaksWithout:
      "Without receipts, every run is ephemeral. You could not prove what the codebase contained at any moment. The chain, the export, the buyer handoff — all impossible.",
    organismMetaphor:
      "DNA. The mechanism for recording what happened so it can be read later, by something that was not there when it happened.",
  },
  {
    nodeId: "chain-link",
    constructionOrder: 4,
    stageName: "The proof of continuity",
    stageRole: "One receipt proves a moment. A chain proves a timeline. This is the step that makes history tamper-evident.",
    whyFirst:
      "A single signed receipt can be forged if you control the signing key. A chain cannot be quietly altered — changing one receipt breaks every hash that follows it. The chain link is what makes the record trustworthy to someone who was not there for any of it.",
    whatBreaksWithout:
      "Without chain linking, each receipt is an island. You can prove what the code looked like at a moment but not that the moments between are unbroken. The audit trail becomes a collection of snapshots rather than a continuous record.",
    organismMetaphor:
      "The nervous system learning to sequence memory. Individual neurons fire (receipts), but the chain is what turns firing into a coherent timeline.",
  },
  {
    nodeId: "receipt-stored",
    constructionOrder: 5,
    stageName: "The ledger",
    stageRole: "The database row that makes the chain queryable, auditable, and survivable across restarts.",
    whyFirst:
      "Filesystem receipts can be lost, moved, or corrupted. The database row is the canonical record. It also makes the chain queryable — you can ask \"show me every run where a CVE appeared\" without reading hundreds of JSON files.",
    whatBreaksWithout:
      "Without persistent storage the chain exists only on disk and only until the next deploy. The compliance story, the buyer handoff, the anomaly history — all depend on these rows surviving.",
    organismMetaphor: "Long-term memory. The organism stops reacting to immediate stimuli and starts learning from its history.",
  },
  {
    nodeId: "chain-export",
    constructionOrder: 6,
    stageName: "The handoff mechanism",
    stageRole: "The point where the system stops talking to itself and starts talking to the outside world.",
    whyFirst:
      "A chain that only the system can read is useful internally but not verifiable externally. The export is what makes the record legible to someone who does not have access to your database — a lawyer, a buyer, an auditor.",
    whatBreaksWithout:
      'Without export, Debrief is a black box. You can say "we ran analysis" but you cannot prove it to anyone outside the system. The signed bundle is the thing you hand over.',
    organismMetaphor:
      "The organism developing the ability to communicate beyond its own membrane. Symbiosis becomes possible.",
  },
];

export interface EvidenceChainModel {
  runId: string;
  targetName: string;
  /** Scheduled target UUID when this project is linked to the evidence chain feature */
  chainTargetId: string | null;
  projectId: number;
  projectUrl: string;
  chainStatus: "intact" | "broken" | "partial";
  chainLength: number;
  lastReceiptAt: string;
  gapsDetected: number;
  anomaliesDetected: number;
  nodes: CognitiveNode[];
  edges: CognitiveEdge[];
  /** True when export signing key is configured and a chain exists */
  exportAvailable: boolean;
  /** Git-derived milestones (may be empty / unavailable) */
  buildHistory: BuildHistoryPayload;
  /** Topological order of node ids — foundations after dependents */
  logicalDependencyOrder: string[];
  /** Environment / secret health for education UI (server-filled) */
  keyStatuses: KeyStatus[];
  /** Construction narrative for “How it grew” education mode */
  historyStages: HistoryStage[];
}

/** Minimal row shape for pure builder + tests (matches DB receipt_chain columns we need). */
export type ChainReceiptInput = {
  runId: string;
  receiptType: string;
  chainSequence: number;
  previousReceiptHash: string | null;
  receiptHash: string;
  anomalyFlagged: boolean;
  newCves: unknown[] | null;
  timestamp: Date | string;
};

export type ChainVerificationInput = {
  chainIntact: boolean;
  brokenAtSequence: number | null;
  gapsCount: number;
  anomaliesCount: number;
};

function iso(d: Date | string | null | undefined): string {
  if (d == null) return "";
  if (typeof d === "string") return d;
  return d.toISOString();
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

type ExtrasInput = {
  receiptForRun: ChainReceiptInput | null;
  projectUrl: string;
};

function anomaliesForNode(nodeId: string, rec: ChainReceiptInput | null): string[] {
  if (!rec) return [];
  const out: string[] = [];
  if (rec.anomalyFlagged) {
    out.push("Flagged change between snapshots (CVE, auth, or API surface)");
  }
  const cves = rec.newCves ?? [];
  for (const c of cves) {
    if (typeof c === "string") out.push(c);
    else if (c && typeof c === "object" && "id" in c) out.push(String((c as { id?: string }).id ?? JSON.stringify(c)));
    else out.push(JSON.stringify(c));
  }
  if ((nodeId === "receipt-stored" || nodeId === "chain-link") && rec.receiptType === "gap") {
    out.push("Scheduled evidence run did not complete — gap row recorded");
  }
  return [...new Set(out)].filter(Boolean);
}

function educationExtras(
  nodeId: string,
  ctx: ExtrasInput,
): Pick<CognitiveNode, "role" | "technology" | "anomalies" | "fileRef" | "alternativeTechnologies"> {
  const rec = ctx.receiptForRun;
  const anomalies = anomaliesForNode(nodeId, rec);
  const map: Record<
    string,
    Pick<CognitiveNode, "role" | "technology" | "fileRef" | "alternativeTechnologies">
  > = {
    target: {
      role:
        "Captures which codebase this brief belongs to so every later step (analysis, receipts, chain) stays tied to the right files.",
      technology: `Remote Git URL or archive you gave Debrief (${truncate(ctx.projectUrl, 60)})`,
      fileRef: "Project settings / run request (URL you paste in Debrief)",
      alternativeTechnologies: ["Zip upload workflow", "Monorepo with multiple roots", "Local path (development only)"],
    },
    analyzer: {
      role:
        "Runs Debrief’s PTA analyzer over a workspace copy — dependency and CVE scans, API surface extraction, and scoring before anything is signed.",
      technology:
        "A Python program that reads every file in your repo, maps dependencies, checks for known vulnerabilities, and scores complexity — then hands results to the Node.js server to store",
      fileRef: "program-totality-analyzer/ and server/runProjectAnalysis.ts (orchestration)",
      alternativeTechnologies: ["Hosted SAST only (no local clone)", "Manual security review", "CI-only static checks without a receipt"],
    },
    "receipt-creation": {
      role:
        "Builds a receipt — a signed JSON fingerprint of what the analyzer saw — so results can be hashed and chained.",
      technology:
        "A JSON file summarizing what the analyzer found, optionally signed with Ed25519 (a cryptographic algorithm that proves the file hasn't been altered since it was created)",
      fileRef: "server/receiptChainFinalize.ts and receipt.json in each run directory",
      alternativeTechnologies: ["Unsigned logs only", "PDF-only audit trail", "External SBOM service"],
    },
    "chain-link": {
      role:
        "Verifies each new receipt references the previous hash correctly so the timeline cannot be silently rewritten.",
      technology:
        "Each receipt gets a unique fingerprint (SHA-256 hash) computed from its contents. The next receipt records that fingerprint, creating a chain where any tampering is immediately visible",
      fileRef: "shared/schema.ts (receipt_chain) and server/chain/verifyChainRows.ts",
      alternativeTechnologies: [
        "Blockchain timestamping",
        "RFC 3161 timestamp authority",
        "Simple hash-only receipts without a database chain",
      ],
    },
    "receipt-stored": {
      role:
        "Persists each receipt row (and gap rows) in Postgres so history survives browser sessions and restarts.",
      technology: "Drizzle ORM + PostgreSQL",
      fileRef: 'Postgres table `receipt_chain` (see shared/schema.ts)',
      alternativeTechnologies: ["Append-only object storage", "Event streaming (Kafka)", "Git as ledger"],
    },
    "chain-export": {
      role:
        "Packages the verified chain for download so legal or compliance can check signatures offline.",
      technology:
        "A downloadable file containing your full receipt history, optionally signed so a third party (lawyer, auditor, buyer) can verify it without needing to trust you",
      fileRef: "server/routes/targets-chain.ts — GET …/chain/export",
      alternativeTechnologies: ["Notary services", "In-app verification only", "Paper binders with screenshots"],
    },
  };
  const m = map[nodeId] || {
    role: "Education node",
    technology: "Debrief stack",
    fileRef: "—",
    alternativeTechnologies: [],
  };
  return { ...m, anomalies };
}

function finalizeEvidenceModel(
  core: Omit<EvidenceChainModel, "buildHistory" | "logicalDependencyOrder">,
): EvidenceChainModel {
  return {
    ...core,
    buildHistory: { events: [], historyAvailable: false },
    logicalDependencyOrder: computeLogicalDependencyOrder(
      core.nodes.map((n) => n.id),
      core.edges,
    ),
  };
}

function applySecretsExposedToTarget(nodes: CognitiveNode[], secretsFindingsCount: number): void {
  if (secretsFindingsCount <= 0) return;
  const target = nodes.find((n) => n.id === "target");
  if (!target) return;
  target.state = "exposed";
  const msg = `TruffleHog found ${secretsFindingsCount} potential secret(s) committed to this repository. Secrets in git history are permanent — rotation is required even after deletion.`;
  if (!target.anomalies.includes(msg)) {
    target.anomalies = [...target.anomalies, msg];
  }
}

/**
 * Build full education model from chain + run context.
 * When `minimal` is true, only Target Repo + Analyzer Run (idle) are returned.
 */
export function buildEvidenceChainModel(input: {
  runId: number;
  projectId: number;
  projectName: string;
  projectUrl: string;
  chainTargetId: string | null;
  receipts: ChainReceiptInput[];
  verification: ChainVerificationInput;
  /** This run completed analysis (has analysis row / finished successfully) */
  analyzerCompleted: boolean;
  /** This run failed before producing analysis */
  analyzerFailed: boolean;
  /** Optional receipt row matching this debrief run */
  receiptForRun: ChainReceiptInput | null;
  exportSigningConfigured: boolean;
  /** Copy helper: mention job queue when runs use BullMQ */
  usesAnalyzerJobQueue: boolean;
  minimal: boolean;
  /** From `secrets_scan.json` (TruffleHog); optional */
  secretsFindingsCount?: number;
  keyStatuses?: KeyStatus[];
}): EvidenceChainModel {
  const {
    runId,
    projectId,
    projectName,
    projectUrl,
    chainTargetId,
    receipts,
    verification,
    analyzerCompleted,
    analyzerFailed,
    receiptForRun,
    exportSigningConfigured,
    usesAnalyzerJobQueue,
    minimal,
    secretsFindingsCount = 0,
    keyStatuses = [],
  } = input;

  const sorted = [...receipts].sort((a, b) => a.chainSequence - b.chainSequence);
  const last = sorted[sorted.length - 1];
  const lastReceiptAt = last ? iso(last.timestamp) : "";
  const chainLength = sorted.length;

  let chainStatus: EvidenceChainModel["chainStatus"] = "intact";
  if (!verification.chainIntact) chainStatus = "broken";
  else if (verification.gapsCount > 0) chainStatus = "partial";

  const displayTarget = truncate(projectName || projectUrl || "Repository", 30);
  const queueNote = usesAnalyzerJobQueue
    ? " Debrief often queues this work in Redis via BullMQ so heavy repos do not block the web server."
    : "";

  const analyzerState: NodeState = analyzerFailed
    ? "broken"
    : !analyzerCompleted
      ? "idle"
      : (() => {
          const an = receiptForRun;
          if (
            an?.anomalyFlagged ||
            (Array.isArray(an?.newCves) && an.newCves.length > 0)
          ) {
            return "anomaly";
          }
          return "clean";
        })();

  const analyzerSublabel = analyzerFailed
    ? "Run did not finish — no brief to seal"
    : !analyzerCompleted
      ? "Waiting for the analyzer to finish"
      : `Scans CVEs, auth changes, and public API surfaces for this repo${queueNote}`;

  if (minimal) {
    const targetNode: CognitiveNode = {
      id: "target",
      shape: "circle",
      layer: "sky",
      label: displayTarget,
      sublabel: "The repository you pointed Debrief at for this brief",
      state: "clean",
      criticality: "essential",
      detailWhat: `This circle is your project entry point — ${projectName || "this repository"} at ${truncate(projectUrl, 48)}. Every later step exists because you asked Debrief to read this codebase.${queueNote}`,
      detailConnections: [{ direction: "to", label: "Triggers analyzer run", nodeId: "analyzer" }],
      detailWatchFor:
        "Green means the UI knows which repo this story is about. If you re-run analysis on a different URL, this label should change so you never mix up two codebases.",
      pulseOrder: 0,
      ...educationExtras("target", { receiptForRun: null, projectUrl }),
    };

    const analyzerNode: CognitiveNode = {
      id: "analyzer",
      shape: "up-triangle",
      layer: "engine",
      label: "Analyzer Run",
      sublabel: analyzerSublabel,
      state: analyzerFailed ? "broken" : "idle",
      criticality: "essential",
      detailWhat: `This step is where Debrief runs the PTA analyzer (Python + tooling) on disk, then writes results to Postgres. There is no chain record yet, so we treat it as idle — you still see where the work would live once scheduled targets link this project.${queueNote}`,
      detailConnections: [
        { direction: "from", label: "Repository you selected", nodeId: "target" },
      ],
      detailWatchFor:
        analyzerFailed
          ? "Red means this run never produced a sealed brief — fix the URL or logs, then try again."
          : "Yellow would mean the run finished but flagged risky deltas (CVEs, auth changes). Gray means we are not pinning this run to a receipt chain row yet.",
      pulseOrder: 1,
      ...educationExtras("analyzer", { receiptForRun: receiptForRun ?? null, projectUrl }),
    };

    const minimalNodes = [targetNode, analyzerNode];
    applySecretsExposedToTarget(minimalNodes, secretsFindingsCount);

    return finalizeEvidenceModel({
      runId: String(runId),
      targetName: displayTarget,
      chainTargetId,
      projectId,
      projectUrl,
      chainStatus,
      chainLength,
      lastReceiptAt,
      gapsDetected: verification.gapsCount,
      anomaliesDetected: verification.anomaliesCount,
      exportAvailable: false,
      nodes: minimalNodes,
      edges: [
        {
          id: "e0",
          source: "target",
          target: "analyzer",
          label: "runs analysis",
          weight: "thick",
          pulseOrder: 0,
        },
      ],
      keyStatuses,
      historyStages: EDUCATION_HISTORY_STAGES,
    });
  }

  const receiptCreationState: NodeState =
    analyzerCompleted && !analyzerFailed ? "clean" : "idle";

  const cveCount = receiptForRun?.newCves?.length ?? 0;
  let chainLinkState: NodeState = "idle";
  if (sorted.length === 0) {
    chainLinkState = "idle";
  } else if (!verification.chainIntact) {
    chainLinkState = "broken";
  } else {
    chainLinkState = "clean";
  }

  let receiptStoredState: NodeState = "healthy";
  let receiptStoredLabel = "Receipt Stored";

  if (receiptForRun?.receiptType === "gap") {
    receiptStoredState = "gap";
    receiptStoredLabel = "Gap in Record";
  } else if (!receiptForRun) {
    receiptStoredState = "idle";
  }

  const exportAvailable = exportSigningConfigured && chainLength > 0;

  const chainExportState: NodeState = exportAvailable ? "healthy" : "idle";

  const targetNode: CognitiveNode = {
    id: "target",
    shape: "circle",
    layer: "sky",
    label: displayTarget,
    sublabel: "Your live codebase reference in Debrief",
    state: "clean",
    criticality: "essential",
    detailWhat: `Human-facing entry: ${projectName || "this repository"} (${truncate(projectUrl, 56)}). This is the “sky” layer — what you touched when you started the run.${queueNote}`,
    detailConnections: [{ direction: "to", label: "Hands work to the analyzer", nodeId: "analyzer" }],
    detailWatchFor:
      "Stays green whenever the page knows which repo you are educating yourself about — if it is wrong, every explanation below is for the wrong codebase.",
    pulseOrder: 0,
    ...educationExtras("target", { receiptForRun, projectUrl }),
  };

  const analyzerNode: CognitiveNode = {
    id: "analyzer",
    shape: "up-triangle",
    layer: "engine",
    label: "Analyzer Run",
    sublabel: analyzerSublabel,
    state: analyzerState,
    criticality: "essential",
    detailWhat: `Debrief’s analyzer run is the “engine room”: PTA ingests files, builds claims, and scores DCI before anything becomes a signed receipt. Results land in Postgres and drive the UI you just came from.${queueNote}`,
    detailConnections: [
      { direction: "from", label: "Repository under study", nodeId: "target" },
      { direction: "to", label: "Feeds receipt creation", nodeId: "receipt-creation" },
    ],
    detailWatchFor:
      "Red means the run failed before we could trust outputs. Yellow means it finished but something risky changed (new CVEs, auth drift) — read the brief. Green means the mechanical scan completed without those flags.",
    pulseOrder: 1,
    ...educationExtras("analyzer", { receiptForRun, projectUrl }),
  };

  const receiptCreationNode: CognitiveNode = {
    id: "receipt-creation",
    shape: "up-triangle",
    layer: "engine",
    label: "Receipt Creation",
    sublabel: "Cryptographic snapshot of this brief's facts",
    state: receiptCreationState,
    criticality: "essential",
    detailWhat:
      "Here Debrief packages the analyzer output into a receipt — a signed JSON document (hashable like a fingerprint) summarizing what was verified on disk. That is the trust anchor you can point auditors to because math, not prose, ties the file to the run.",
    detailConnections: [
      { direction: "from", label: "Finished analyzer output", nodeId: "analyzer" },
      { direction: "to", label: "Prepares chain link proof", nodeId: "chain-link" },
    ],
    detailWatchFor:
      "Green means the receipt was formed for a successful run — downstream hashes depend on it. Idle means the analyzer never sealed a snapshot for this story.",
    pulseOrder: 2,
    ...educationExtras("receipt-creation", { receiptForRun, projectUrl }),
  };

  const chainLinkNode: CognitiveNode = {
    id: "chain-link",
    shape: "up-triangle",
    layer: "engine",
    label: "Chain Link",
    sublabel: "Continuity check vs the last snapshot",
    state: chainLinkState,
    criticality: "essential",
    detailWhat:
      "This is the moment Debrief proves no one tampered with your record. It reads a fingerprint (cryptographic hash) of the last snapshot and checks that this new one connects to it cleanly. If this node is green, your entire history is intact. If it is red, something in the chain does not match — and that matters because anyone auditing you will see the break.",
    detailConnections: [
      { direction: "from", label: "Fresh receipt payload", nodeId: "receipt-creation" },
      { direction: "to", label: "Hands off to history storage", nodeId: "receipt-stored" },
    ],
    detailWatchFor:
      "⚠️ If this turns red: the chain is broken — a receipt is missing, edited, or out of order in Postgres.\n\n✓ If this is green: every prior snapshot lines up with the next; your narrative of change is uninterrupted.",
    pulseOrder: 3,
    ...educationExtras("chain-link", { receiptForRun, projectUrl }),
  };

  const receiptStoredNode: CognitiveNode = {
    id: "receipt-stored",
    shape: "down-triangle",
    layer: "foundation",
    label: receiptStoredLabel,
    sublabel:
      receiptForRun?.receiptType === "gap"
        ? "Scheduled snapshot never arrived"
        : "Row in the receipt_chain table",
    state: receiptStoredState,
    criticality: "important",
    detailWhat:
      receiptForRun?.receiptType === "gap"
        ? "This is a gap receipt — Debrief recorded that a scheduled pass should have happened but did not. Think of it as an empty page in a lab notebook: the absence is deliberate evidence so you can explain missed runs to your team or auditors."
        : "Down triangles are “foundation” memory: each row in `receipt_chain` is immutable history — hashes, sequences, and the JSON receipt document as stored after the run.",
    detailConnections: [
      { direction: "from", label: "Verified chain connection", nodeId: "chain-link" },
      { direction: "to", label: "Feeds signed export", nodeId: "chain-export" },
    ],
    detailWatchFor:
      receiptForRun?.receiptType === "gap"
        ? "Red with the warning icon means time history has a hole — investigate scheduler/worker health and why Debrief never received artifacts."
        : "Blue means the row is a normal historical record. Red (gap) means you are looking at a wound in the timeline, not just missing UI data.",
    pulseOrder: 4,
    ...educationExtras("receipt-stored", { receiptForRun, projectUrl }),
  };

  const chainExportNode: CognitiveNode = {
    id: "chain-export",
    shape: "down-triangle",
    layer: "foundation",
    label: "Signed Evidence Bundle",
    sublabel: "Portable artifact for auditors",
    state: chainExportState,
    criticality: "important",
    detailWhat:
      "The export step packages the verified chain JSON and optionally signs it with your configured private key so third parties can validate integrity offline — the most grounded artifact Debrief produces, meant for legal or compliance handoffs.",
    detailConnections: [{ direction: "from", label: "Immutable history rows", nodeId: "receipt-stored" }],
    detailWatchFor:
      "Blue means signing is configured and the chain could be exported as a sealed bundle. Idle means either signing keys are not set or the chain is not ready — you can still read receipts in-app, but you are not holding a notarized packet yet.",
    pulseOrder: 5,
    ...educationExtras("chain-export", { receiptForRun, projectUrl }),
  };

  const nodes = [
    targetNode,
    analyzerNode,
    receiptCreationNode,
    chainLinkNode,
    receiptStoredNode,
    chainExportNode,
  ];

  const edges: CognitiveEdge[] = [
    {
      id: "e0",
      source: "target",
      target: "analyzer",
      label: "runs analysis",
      weight: "thick",
      pulseOrder: 0,
    },
    {
      id: "e1",
      source: "analyzer",
      target: "receipt-creation",
      label: "creates receipt",
      weight: "thick",
      pulseOrder: 1,
    },
    {
      id: "e2",
      source: "receipt-creation",
      target: "chain-link",
      label: "links to chain",
      weight: "thick",
      pulseOrder: 2,
    },
    {
      id: "e3",
      source: "chain-link",
      target: "receipt-stored",
      label: "stores in history",
      weight: "thick",
      pulseOrder: 3,
    },
    {
      id: "e4",
      source: "receipt-stored",
      target: "chain-export",
      label: "exports bundle",
      weight: "thick",
      pulseOrder: 4,
    },
  ];

  applySecretsExposedToTarget(nodes, secretsFindingsCount);

  return finalizeEvidenceModel({
    runId: String(runId),
    targetName: displayTarget,
    chainTargetId,
    projectId,
    projectUrl,
    chainStatus,
    chainLength,
    lastReceiptAt,
    gapsDetected: verification.gapsCount,
    anomaliesDetected: verification.anomaliesCount,
    exportAvailable,
    nodes,
    edges,
    keyStatuses,
    historyStages: EDUCATION_HISTORY_STAGES,
  });
}
