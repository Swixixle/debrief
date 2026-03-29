import { describe, expect, it } from "vitest";
import type { BuildEvent } from "@shared/evidenceChainModel";
import { buildEvidenceChainModel } from "@shared/evidenceChainModel";
import { computeLogicalDependencyOrder } from "@shared/educationTopology";
import { inferBuildHistory, parseGitBlocks, resolveHighlightIdsForEvent } from "../buildHistory";

const baseReceipt = {
  runId: "1",
  receiptType: "analysis",
  chainSequence: 0,
  previousReceiptHash: null as string | null,
  receiptHash: "aaa",
  anomalyFlagged: false,
  newCves: [] as unknown[],
  timestamp: "2026-03-01T00:00:00.000Z",
};

describe("buildEvidenceChainModel", () => {
  it("produces six nodes and thick edges for a three-receipt chain", () => {
    const receipts = [
      { ...baseReceipt, chainSequence: 0, runId: "10", receiptHash: "h0" },
      { ...baseReceipt, chainSequence: 1, runId: "11", receiptHash: "h1", previousReceiptHash: "h0" },
      { ...baseReceipt, chainSequence: 2, runId: "12", receiptHash: "h2", previousReceiptHash: "h1" },
    ];
    const model = buildEvidenceChainModel({
      runId: 12,
      projectId: 7,
      projectName: "demo/app",
      projectUrl: "https://github.com/demo/app",
      chainTargetId: "tgt-1",
      receipts,
      verification: {
        chainIntact: true,
        brokenAtSequence: null,
        gapsCount: 0,
        anomaliesCount: 0,
      },
      analyzerCompleted: true,
      analyzerFailed: false,
      receiptForRun: receipts[2],
      exportSigningConfigured: true,
      usesAnalyzerJobQueue: true,
      minimal: false,
    });

    expect(model.nodes).toHaveLength(6);
    expect(model.edges).toHaveLength(5);
    expect(model.edges.every((e) => e.weight === "thick")).toBe(true);
    const link = model.nodes.find((n) => n.id === "chain-link");
    expect(link?.state).toBe("clean");
    expect(model.keyStatuses).toEqual([]);
  });

  it("marks target exposed when secrets scan reported findings", () => {
    const receipts = [
      { ...baseReceipt, chainSequence: 0, runId: "10", receiptHash: "h0" },
      { ...baseReceipt, chainSequence: 1, runId: "11", receiptHash: "h1", previousReceiptHash: "h0" },
      { ...baseReceipt, chainSequence: 2, runId: "12", receiptHash: "h2", previousReceiptHash: "h1" },
    ];
    const model = buildEvidenceChainModel({
      runId: 12,
      projectId: 7,
      projectName: "demo/app",
      projectUrl: "https://github.com/demo/app",
      chainTargetId: "tgt-1",
      receipts,
      verification: {
        chainIntact: true,
        brokenAtSequence: null,
        gapsCount: 0,
        anomaliesCount: 0,
      },
      analyzerCompleted: true,
      analyzerFailed: false,
      receiptForRun: receipts[2],
      exportSigningConfigured: true,
      usesAnalyzerJobQueue: true,
      minimal: false,
      secretsFindingsCount: 2,
      keyStatuses: [],
    });
    const target = model.nodes.find((n) => n.id === "target");
    expect(target?.state).toBe("exposed");
    expect(target?.anomalies.some((a) => a.includes("TruffleHog found 2"))).toBe(true);
  });

  it("marks chain-link broken when verification reports a break", () => {
    const receipts = [
      { ...baseReceipt, chainSequence: 0, runId: "10", receiptHash: "h0" },
      { ...baseReceipt, chainSequence: 1, runId: "11", receiptHash: "h1", previousReceiptHash: "wrong" },
    ];
    const model = buildEvidenceChainModel({
      runId: 11,
      projectId: 7,
      projectName: "demo/app",
      projectUrl: "https://github.com/demo/app",
      chainTargetId: "tgt-1",
      receipts,
      verification: {
        chainIntact: false,
        brokenAtSequence: 1,
        gapsCount: 0,
        anomaliesCount: 0,
      },
      analyzerCompleted: true,
      analyzerFailed: false,
      receiptForRun: receipts[1],
      exportSigningConfigured: false,
      usesAnalyzerJobQueue: false,
      minimal: false,
    });
    const link = model.nodes.find((n) => n.id === "chain-link");
    expect(link?.state).toBe("broken");
  });

  it("labels receipt stored as Gap in Record when receipt is a gap", () => {
    const gap = {
      ...baseReceipt,
      chainSequence: 2,
      runId: "gap-1",
      receiptType: "gap",
      receiptHash: "hg",
      previousReceiptHash: "prev",
    };
    const model = buildEvidenceChainModel({
      runId: 99,
      projectId: 3,
      projectName: "svc",
      projectUrl: "https://gitlab.com/org/svc",
      chainTargetId: "t2",
      receipts: [gap],
      verification: {
        chainIntact: true,
        brokenAtSequence: null,
        gapsCount: 1,
        anomaliesCount: 0,
      },
      analyzerCompleted: true,
      analyzerFailed: false,
      receiptForRun: gap,
      exportSigningConfigured: true,
      usesAnalyzerJobQueue: false,
      minimal: false,
    });
    const stored = model.nodes.find((n) => n.id === "receipt-stored");
    expect(stored?.label).toBe("Gap in Record");
    expect(stored?.state).toBe("gap");
  });

  it("minimal mode returns two nodes", () => {
    const model = buildEvidenceChainModel({
      runId: 5,
      projectId: 1,
      projectName: "solo",
      projectUrl: "https://github.com/x/solo",
      chainTargetId: null,
      receipts: [],
      verification: {
        chainIntact: true,
        brokenAtSequence: null,
        gapsCount: 0,
        anomaliesCount: 0,
      },
      analyzerCompleted: true,
      analyzerFailed: false,
      receiptForRun: null,
      exportSigningConfigured: false,
      usesAnalyzerJobQueue: false,
      minimal: true,
    });
    expect(model.nodes).toHaveLength(2);
    expect(model.edges).toHaveLength(1);
  });

  it("includes historyStages for education “How it grew” mode", () => {
    const model = buildEvidenceChainModel({
      runId: 5,
      projectId: 1,
      projectName: "solo",
      projectUrl: "https://github.com/x/solo",
      chainTargetId: null,
      receipts: [],
      verification: {
        chainIntact: true,
        brokenAtSequence: null,
        gapsCount: 0,
        anomaliesCount: 0,
      },
      analyzerCompleted: true,
      analyzerFailed: false,
      receiptForRun: null,
      exportSigningConfigured: false,
      usesAnalyzerJobQueue: false,
      minimal: true,
    });
    expect(model.historyStages).toHaveLength(6);
    expect(model.historyStages[0].nodeId).toBe("target");
    expect(model.historyStages[5].nodeId).toBe("chain-export");
  });

  it("includes buildHistory and logicalDependencyOrder from finalizeEvidenceModel", () => {
    const model = buildEvidenceChainModel({
      runId: 5,
      projectId: 1,
      projectName: "solo",
      projectUrl: "https://github.com/x/solo",
      chainTargetId: null,
      receipts: [],
      verification: {
        chainIntact: true,
        brokenAtSequence: null,
        gapsCount: 0,
        anomaliesCount: 0,
      },
      analyzerCompleted: true,
      analyzerFailed: false,
      receiptForRun: null,
      exportSigningConfigured: false,
      usesAnalyzerJobQueue: false,
      minimal: true,
    });
    expect(model.logicalDependencyOrder.length).toBeGreaterThan(0);
    expect(model.buildHistory.historyAvailable).toBe(false);
  });
});

describe("resolveHighlightIdsForEvent", () => {
  const threeChainModel = () => {
    const receipts = [
      { ...baseReceipt, chainSequence: 0, runId: "10", receiptHash: "h0" },
      { ...baseReceipt, chainSequence: 1, runId: "11", receiptHash: "h1", previousReceiptHash: "h0" },
      { ...baseReceipt, chainSequence: 2, runId: "12", receiptHash: "h2", previousReceiptHash: "h1" },
    ];
    return buildEvidenceChainModel({
      runId: 12,
      projectId: 7,
      projectName: "demo/app",
      projectUrl: "https://github.com/demo/app",
      chainTargetId: "tgt-1",
      receipts,
      verification: {
        chainIntact: true,
        brokenAtSequence: null,
        gapsCount: 0,
        anomaliesCount: 0,
      },
      analyzerCompleted: true,
      analyzerFailed: false,
      receiptForRun: receipts[2],
      exportSigningConfigured: true,
      usesAnalyzerJobQueue: true,
      minimal: false,
    });
  };

  const ev = (milestone: string, files: string[] = []): BuildEvent => ({
    commitHash: "a".repeat(40),
    timestamp: "2026-03-01 00:00:00 +0000",
    message: "m",
    filesAdded: files,
    inferredMilestone: milestone,
    highlightIds: [],
  });

  it("uses Project scaffolded to highlight target when file paths do not match fileRef", () => {
    const model = threeChainModel();
    const ids = resolveHighlightIdsForEvent(ev("Project scaffolded"), model.nodes);
    expect(ids).toContain("target");
    expect(ids.length).toBeGreaterThan(0);
  });

  it("uses Evidence chain added to highlight chain-link and receipt-creation", () => {
    const model = threeChainModel();
    const ids = resolveHighlightIdsForEvent(ev("Evidence chain added"), model.nodes);
    expect(ids).toContain("chain-link");
    expect(ids).toContain("receipt-creation");
  });

  it("pass 1: exact file match ties to node with same fileRef", () => {
    const model = threeChainModel();
    const withRef = model.nodes.map((n) =>
      n.id === "analyzer" ? { ...n, fileRef: "server/analyzer.ts" } : n,
    );
    const ids = resolveHighlightIdsForEvent(
      ev("API routes added", ["server/analyzer.ts"]),
      withRef,
    );
    expect(ids).toContain("analyzer");
  });
});

describe("parseGitBlocks / inferBuildHistory", () => {
  it("parses mock git log into at least two milestones", () => {
    const raw = `1111111111111111111111111111111111111111|2026-03-14 10:00:00 +0000|scaffold
package.json

2222222222222222222222222222222222222222|2026-03-15 10:00:00 +0000|add auth
src/auth/clerk.tsx`;
    const events = parseGitBlocks(raw);
    expect(events.length).toBeGreaterThanOrEqual(2);
    const labels = events.map((e) => e.inferredMilestone).filter(Boolean);
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });

  it("returns historyAvailable false for empty repo path", async () => {
    const r = await inferBuildHistory("");
    expect(r.historyAvailable).toBe(false);
    expect(r.events.length).toBe(0);
  });
});

describe("computeLogicalDependencyOrder", () => {
  it("lists nodes with no incoming edges before their dependents", () => {
    const order = computeLogicalDependencyOrder(
      ["target", "analyzer", "receipt"],
      [
        { source: "target", target: "analyzer" },
        { source: "analyzer", target: "receipt" },
      ],
    );
    expect(order.indexOf("target")).toBeLessThan(order.indexOf("analyzer"));
    expect(order.indexOf("analyzer")).toBeLessThan(order.indexOf("receipt"));
  });
});
