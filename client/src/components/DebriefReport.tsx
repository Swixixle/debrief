import { useMemo, useState } from "react";
import type { Analysis } from "@shared/schema";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectRuns } from "@/hooks/use-projects";
import { HistoryAuthNudge } from "@/components/HistoryAuthNudge";
import { Link, useLocation } from "wouter";
import { Hexagon } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const DEBRIEF_VERSION = "1.0";

export type DebriefProject = {
  name: string;
  url: string;
};

type DebriefReportProps = {
  project: DebriefProject;
  analysis: Analysis;
  /** Optional cryptographic signature string when a certificate exists */
  evidenceSignature?: string | null;
  /** Stored project preference: learner runs surface LEARNER_REPORT.md first */
  reportAudience?: "pro" | "learner" | null;
  projectId?: number;
  selectedRunId?: number | null;
  /** True when this view is backed by a cached analyzer result (Redis content hash hit). */
  cacheHit?: boolean;
};

function formatRunListDate(raw: string | Date | null | undefined): string {
  if (!raw) return "—";
  const d = typeof raw === "string" ? new Date(raw) : raw;
  return isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { month: "short", day: "numeric" });
}

function RunHistoryPanel({
  projectId,
  reportAudience,
  selectedRunId,
}: {
  projectId: number;
  reportAudience: "pro" | "learner";
  selectedRunId: number | null;
}) {
  const { data: runs, isPending, isError } = useProjectRuns(projectId);
  const [, setLocation] = useLocation();

  if (isPending) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
        Loading run history…
      </div>
    );
  }
  if (isError || !runs?.length) return null;

  const chronological = [...runs].reverse();
  const chartData = chronological.map((r) => ({
    label: formatRunListDate(r.created_at),
    dciPct: r.dci_score != null ? Number(r.dci_score) * 100 : 0,
  }));

  const first = chronological[0];
  const latest = chronological[chronological.length - 1];

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-xs p-6 mb-6 space-y-4">
      <h3 className="text-lg font-semibold text-slate-900">Run history</h3>

      <HistoryAuthNudge show={runs.length >= 2} />

      {reportAudience === "learner" && runs.length >= 2 ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200/80 px-4 py-3 text-sm text-emerald-950 space-y-1">
          <p className="font-medium">Since your first run:</p>
          <p>
            ✅ DCI score:{" "}
            {first?.dci_score != null ? `${(Number(first.dci_score) * 100).toFixed(1)}%` : "—"} →{" "}
            {latest?.dci_score != null ? `${(Number(latest.dci_score) * 100).toFixed(1)}%` : "—"}
          </p>
          <p>
            ✅ Claims tracked: {first?.claim_count ?? "—"} → {latest?.claim_count ?? "—"}
          </p>
        </div>
      ) : null}

      <div className="h-36 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={32} />
            <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, "DCI"]} />
            <Line type="monotone" dataKey="dciPct" stroke="#0d9488" strokeWidth={2} dot={{ r: 3 }} name="DCI" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Mode</th>
              <th className="py-2 pr-3">DCI</th>
              <th className="py-2 pr-3">Claims</th>
              <th className="py-2 pr-3">Cache</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.id}
                data-testid={`run-row-${r.id}`}
                className={`border-b border-slate-100 ${selectedRunId === r.id ? "bg-amber-50/90" : ""}`}
              >
                <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">
                  {formatRunListDate(r.created_at)}
                </td>
                <td className="py-2 pr-3 capitalize">{r.mode}</td>
                <td className="py-2 pr-3">
                  {r.dci_score != null ? `${(Number(r.dci_score) * 100).toFixed(1)}%` : "—"}
                </td>
                <td className="py-2 pr-3">{r.claim_count ?? "—"}</td>
                <td className="py-2 pr-3">{r.cache_hit ? "⚡" : "—"}</td>
                <td className="py-2 text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => setLocation(`/projects/${projectId}?runId=${r.id}`)}
                  >
                    View
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ToolRec = {
  name: string;
  description: string;
  href: string;
};

const TOOL_RULES: { match: (s: string) => boolean; tools: ToolRec[] }[] = [
  {
    match: (s) => /observability|logging|monitoring|metrics|tracing/i.test(s),
    tools: [
      { name: "Sentry", description: "Error tracking and performance monitoring for production apps.", href: "https://sentry.io" },
      { name: "Datadog", description: "Full-stack observability, APM, and infrastructure monitoring.", href: "https://www.datadoghq.com" },
    ],
  },
  {
    match: (s) => /test|testing|coverage|e2e|unit test/i.test(s),
    tools: [
      { name: "Vitest", description: "Fast unit test runner aligned with the Vite ecosystem.", href: "https://vitest.dev" },
      { name: "Jest", description: "Popular JavaScript test framework with a rich matcher API.", href: "https://jestjs.io" },
      { name: "Playwright", description: "End-to-end testing across browsers with reliable automation.", href: "https://playwright.dev" },
    ],
  },
  {
    match: (s) => /auth|authentication|oauth|login|session|jwt/i.test(s),
    tools: [
      { name: "Auth0", description: "Identity platform for authentication and authorization.", href: "https://auth0.com" },
      { name: "Clerk", description: "Drop-in user management and SSO for modern web apps.", href: "https://clerk.com" },
      { name: "Auth.js (NextAuth)", description: "Open auth library for Next.js and other frameworks.", href: "https://authjs.dev" },
    ],
  },
  {
    match: (s) => /analytics|product analytics|funnel|event tracking/i.test(s),
    tools: [
      { name: "PostHog", description: "Product analytics, feature flags, and session replay.", href: "https://posthog.com" },
      { name: "Plausible", description: "Privacy-friendly, lightweight web analytics.", href: "https://plausible.io" },
    ],
  },
  {
    match: (s) => /documentation|docs site|readme|developer portal/i.test(s),
    tools: [
      { name: "Mintlify", description: "Beautiful developer documentation with a polished default theme.", href: "https://mintlify.com" },
      { name: "Docusaurus", description: "Static-site generator geared to product and API documentation.", href: "https://docusaurus.io" },
    ],
  },
];

function formatAnalysisTime(analysis: Analysis): string {
  const raw = analysis.createdAt as unknown as string | Date | undefined;
  if (!raw) return "—";
  const d = typeof raw === "string" ? new Date(raw) : raw;
  return isNaN(d.getTime()) ? "—" : d.toISOString();
}

function stripMdToPlain(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
    .trim();
}

function firstParagraphSummaries(text: string, maxSentences: number): string {
  const plain = stripMdToPlain(text).replace(/\n+/g, " ");
  const parts = plain.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, maxSentences).join(" ") || plain.slice(0, 480) || "No summary available yet.";
}

function normalizeUnknowns(raw: unknown): string[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  return raw.map((u: any) =>
    typeof u === "string" ? u : u?.what_is_missing || u?.description || u?.item || JSON.stringify(u),
  );
}

function normalizeClaims(raw: unknown): { statement: string; ref: string }[] {
  if (!raw) return [];
  const arr: any[] = Array.isArray(raw) ? raw : (raw as any)?.claims && Array.isArray((raw as any).claims) ? (raw as any).claims : [];
  return arr.map((claim) => {
    const statement = claim.claim || claim.statement || "Finding";
    const evidence = claim.evidence;
    let ref = "";
    if (Array.isArray(evidence)) {
      ref = evidence.map((ev: any) => ev.display || `${ev.path}:${ev.line_start}`).filter(Boolean).join("; ");
    }
    return { statement, ref };
  });
}

function watchItemsFromOperateGaps(operate: any): { statement: string; ref: string }[] {
  if (!operate?.gaps || !Array.isArray(operate.gaps)) return [];
  return operate.gaps.map((gap: any) => ({
    statement: [gap.title, gap.recommendation || gap.action].filter(Boolean).join(" — ") || "Operational gap",
    ref: gap.evidence?.display || (Array.isArray(gap.evidence) ? gap.evidence.map((e: any) => e.display).join("; ") : "") || "",
  }));
}

function anatomyProse(operate: any): string[] {
  if (!operate) {
    return ["No structured operator profile was generated for this repository."];
  }
  const paragraphs: string[] = [];
  const mode = operate.mode ? `Analysis mode: ${operate.mode}.` : "";
  const ver = operate.tool_version ? ` Tool version: ${operate.tool_version}.` : "";
  if (mode || ver) paragraphs.push(`${mode}${ver}`.trim());

  const boot = operate.boot;
  if (boot) {
    const parts: string[] = [];
    if (boot.install?.length) parts.push(`${boot.install.length} install command(s) were detected`);
    if (boot.dev?.length) parts.push(`${boot.dev.length} dev start path(s)`);
    if (boot.prod?.length) parts.push(`${boot.prod.length} production start path(s)`);
    if (boot.ports?.length) parts.push(`port configuration noted (${boot.ports.length} item(s))`);
    if (parts.length) paragraphs.push(`Boot and runtime: ${parts.join("; ")}.`);
  }

  const integ = operate.integrate;
  if (integ) {
    const e = integ.endpoints?.length ?? 0;
    const v = integ.env_vars?.length ?? 0;
    const a = integ.auth?.length ?? 0;
    if (e + v + a > 0) {
      paragraphs.push(
        `Integrations: approximately ${e} API surface item(s), ${v} referenced environment variable(s), and ${a} auth-related signal(s) were extracted from static artifacts.`,
      );
    }
  }

  const dep = operate.deploy;
  if (dep) {
    const plat = dep.platform?.length ?? 0;
    const ci = dep.ci?.length ?? 0;
    const ctr = dep.containerization?.length ?? 0;
    if (plat + ci + ctr > 0) {
      paragraphs.push(
        `Deployment signals: ${plat} platform hint(s), ${ci} CI reference(s), ${ctr} containerization reference(s).`,
      );
    }
  }

  if (paragraphs.length === 0) paragraphs.push("Structured operator data was present but did not yield a prose summary.");
  return paragraphs;
}

function collectGapText(unknowns: string[], operate: any): string {
  const gapTitles = (operate?.gaps || []).map((g: any) => `${g.title || ""} ${g.recommendation || g.action || ""}`);
  return [...unknowns, ...gapTitles].join(" ").toLowerCase();
}

function toolRecommendationsForGaps(blob: string): ToolRec[] {
  const seen = new Set<string>();
  const out: ToolRec[] = [];
  for (const rule of TOOL_RULES) {
    if (!rule.match(blob)) continue;
    for (const t of rule.tools) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      out.push(t);
    }
  }
  return out;
}

type DependencyGraphJson = {
  summary?: {
    direct_total?: number;
    direct_production?: number;
    direct_development?: number;
    flagged_cve_count?: number;
    count_by_ecosystem?: Record<string, number>;
  };
  lockfiles_detected?: string[];
  dependencies?: Array<{
    name: string;
    version: string;
    kind?: string;
    ecosystem?: string;
    license?: string | null;
    osv_vulnerable?: boolean;
    osv_ids?: string[];
  }>;
};

function dependencyRows(graph: DependencyGraphJson | null | undefined): NonNullable<DependencyGraphJson["dependencies"]> {
  const raw = graph?.dependencies;
  return Array.isArray(raw) ? raw : [];
}

type ApiSurfaceJson = {
  summary?: {
    endpoint_count?: number;
    authenticated?: number;
    open?: number;
    unknown_auth?: number;
    webhooks_outbound?: number;
    webhooks_inbound?: number;
    websocket_signals?: number;
  };
  endpoints?: Array<{
    method: string;
    path: string;
    auth?: string;
    confidence?: string;
    citation?: string;
    file?: string;
    line?: number;
  }>;
  webhooks_outbound?: Array<{ name?: string; path_or_url?: string; citation?: string; auth?: string }>;
  webhooks_inbound?: Array<{ path_or_url?: string; citation?: string; auth?: string }>;
  websocket?: Array<{ citation?: string; detail?: string }>;
};

function apiEndpointRows(surface: ApiSurfaceJson | null | undefined): NonNullable<ApiSurfaceJson["endpoints"]> {
  const raw = surface?.endpoints;
  return Array.isArray(raw) ? raw : [];
}

function ApiSurfacePanel({ surface }: { surface: ApiSurfaceJson | null | undefined }) {
  const [filter, setFilter] = useState("");
  const rows = apiEndpointRows(surface);
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          (r.path || "").toLowerCase().includes(q) ||
          (r.method || "").toLowerCase().includes(q) ||
          (r.citation || "").toLowerCase().includes(q),
      )
    : rows;

  if (!surface || rows.length === 0) {
    return (
      <p className="text-slate-600 text-sm">
        No API surface snapshot was stored for this analysis. Re-run Debrief with the latest analyzer to populate static
        route extraction.
      </p>
    );
  }

  const s = surface.summary || {};
  const n = s.endpoint_count ?? rows.length;
  const xa = s.authenticated ?? 0;
  const yo = s.open ?? 0;
  const zu = s.unknown_auth ?? 0;
  const wo = s.webhooks_outbound ?? 0;
  const wi = s.webhooks_inbound ?? 0;

  const rowClass = (auth: string | undefined) => {
    if (auth === "OPEN") return "bg-red-50/90";
    if (auth === "UNKNOWN") return "bg-amber-50/80";
    return "";
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">HTTP endpoints</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{n}</p>
          <p className="text-xs text-slate-600 mt-1">
            Authenticated {xa} · Open {yo} · Unknown auth {zu}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Webhooks</p>
          <p className="text-sm text-slate-800 mt-2">
            Inbound <span className="font-semibold">{wi}</span> · Outbound <span className="font-semibold">{wo}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label htmlFor="api-filter" className="text-sm text-slate-600 shrink-0">
          Filter routes
        </label>
        <Input
          id="api-filter"
          type="search"
          placeholder="path, method, file…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-md bg-white"
        />
        <span className="text-xs text-slate-500">
          Showing {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-3 py-2 font-semibold">Method</th>
              <th className="px-3 py-2 font-semibold">Path</th>
              <th className="px-3 py-2 font-semibold">Auth</th>
              <th className="px-3 py-2 font-semibold">File</th>
              <th className="px-3 py-2 font-semibold">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr
                key={`${r.citation}-${r.path}-${i}`}
                className={`border-t border-slate-200 ${rowClass(r.auth)}`}
              >
                <td className="px-3 py-2 font-mono text-xs">{r.method}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-800 break-all">{r.path}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      r.auth === "OPEN"
                        ? "text-red-800 font-semibold text-xs"
                        : r.auth === "UNKNOWN"
                          ? "text-amber-900 font-medium text-xs"
                          : "text-slate-700 text-xs"
                    }
                  >
                    {r.auth || "—"}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-700 break-all">{r.citation || "—"}</td>
                <td className="px-3 py-2 text-slate-600 text-xs">{r.confidence || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DependencyInventoryPanel({ graph }: { graph: DependencyGraphJson | null | undefined }) {
  const [filter, setFilter] = useState("");
  const rows = dependencyRows(graph);
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? rows.filter((d) => (d.name || "").toLowerCase().includes(q) || (d.ecosystem || "").toLowerCase().includes(q))
    : rows;

  if (!graph || rows.length === 0) {
    return (
      <p className="text-slate-600 text-sm">
        No dependency inventory was stored for this analysis. Re-run the analyzer on a repo with a supported lockfile to
        populate OSV-flagged dependency data.
      </p>
    );
  }

  const s = graph.summary || {};
  const prod = s.direct_production ?? 0;
  const dev = s.direct_development ?? 0;
  const flagged = s.flagged_cve_count ?? 0;
  const total = s.direct_total ?? rows.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Direct dependencies</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{total}</p>
          <p className="text-xs text-slate-600 mt-1">
            Production {prod} · Dev {dev}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">OSV-flagged</p>
          <p className={`text-2xl font-semibold mt-1 ${flagged > 0 ? "text-amber-800" : "text-emerald-800"}`}>{flagged}</p>
          <p className="text-xs text-slate-600 mt-1">Known vulns (point-in-time OSV scan)</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lockfiles</p>
          <p className="text-sm text-slate-800 mt-2">
            {(graph.lockfiles_detected || []).length
              ? (graph.lockfiles_detected || []).join(", ")
              : "—"}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label htmlFor="dep-filter" className="text-sm text-slate-600 shrink-0">
          Filter by name
        </label>
        <Input
          id="dep-filter"
          type="search"
          placeholder="e.g. lodash, PyPI…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-md bg-white"
        />
        <span className="text-xs text-slate-500">
          Showing {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Version</th>
              <th className="px-3 py-2 font-semibold">License</th>
              <th className="px-3 py-2 font-semibold">CVE / OSV</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d, i) => (
              <tr key={`${d.name}-${d.version}-${i}`} className="border-t border-slate-200">
                <td className="px-3 py-2 font-medium text-slate-900">{d.name}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-800">{d.version}</td>
                <td className="px-3 py-2 text-slate-700">{d.license || "—"}</td>
                <td className="px-3 py-2">
                  {d.osv_vulnerable ? (
                    <span className="inline-flex flex-col gap-0.5">
                      <span className="text-amber-800 font-medium text-xs">Flagged</span>
                      {(d.osv_ids || []).length ? (
                        <span className="font-mono text-[11px] text-slate-600">{(d.osv_ids || []).join(", ")}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-slate-500 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function evidenceRows(analysis: Analysis): { path: string; hash: string; status: string }[] {
  const rows: { path: string; hash: string; status: string }[] = [];
  const raw = analysis.claims as any;
  const claims: any[] = Array.isArray(raw) ? raw : raw?.claims && Array.isArray(raw.claims) ? raw.claims : [];
  for (const c of claims) {
    const evs = Array.isArray(c.evidence) ? c.evidence : [];
    for (const ev of evs) {
      const p = ev.path || "—";
      const h = (ev.snippet_hash || "—").toString().slice(0, 16);
      const st = c.status === "evidenced" || c.verified === true ? "Anchored" : "Referenced";
      rows.push({ path: p, hash: h, status: st });
    }
  }
  const cov = analysis.coverage as Record<string, unknown> | null;
  if (rows.length === 0 && cov && typeof cov.run_id === "string") {
    rows.push({
      path: `(coverage run ${cov.run_id})`,
      hash: String(cov.run_id).slice(0, 16),
      status: `scanned ${(cov as any).scanned ?? 0} / skipped ${(cov as any).skipped ?? 0}`,
    });
  }
  if (rows.length === 0) {
    rows.push({ path: "—", hash: "—", status: "No per-file evidence rows in stored analysis" });
  }
  return rows;
}

function sectionShell(title: string, children: React.ReactNode) {
  return (
    <section className="border-l-4 border-l-slate-300 pl-6 pr-2 py-8 border-b border-slate-200 last:border-b-0">
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900 mb-6">{title}</h2>
      <div className="text-slate-800 space-y-4">{children}</div>
    </section>
  );
}

export function DebriefReport({
  project,
  analysis,
  evidenceSignature,
  reportAudience = "pro",
  projectId,
  selectedRunId = null,
  cacheHit = false,
}: DebriefReportProps) {
  const narrative = (analysis as { narrative_summary?: string }).narrative_summary;
  const dossier = analysis.dossier || "";
  const summaryText = narrative?.trim()
    ? firstParagraphSummaries(narrative, 5)
    : dossier
      ? firstParagraphSummaries(dossier, 5)
      : "No narrative or dossier text was available for this analysis.";

  const operate = analysis.operate as any;
  const unknownsList = normalizeUnknowns(analysis.unknowns);
  const runsQuery = useProjectRuns(projectId ?? 0);
  const newestRunId = runsQuery.data?.[0]?.id ?? null;
  const educationRunId = selectedRunId ?? newestRunId;

  const watchList = useMemo(() => {
    const claimItems = normalizeClaims(analysis.claims);
    const gapWatch = watchItemsFromOperateGaps(operate);
    const merged = [...claimItems, ...gapWatch];
    const seen = new Set<string>();
    return merged.filter((w) => {
      const k = `${w.statement}|${w.ref}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [analysis.claims, operate]);

  const dependencyGraph = (analysis as { dependencyGraph?: DependencyGraphJson | null }).dependencyGraph;
  const apiSurface = (analysis as { apiSurface?: ApiSurfaceJson | null }).apiSurface;

  const anatomy = useMemo(() => anatomyProse(operate), [operate]);
  const blob = useMemo(() => collectGapText(unknownsList, operate), [unknownsList, operate]);
  const tools = useMemo(() => toolRecommendationsForGaps(blob), [blob]);
  const tableRows = useMemo(() => evidenceRows(analysis), [analysis]);

  const commitSha =
    (operate?.snapshot?.commit_sha as string | undefined) ||
    (operate?.commit_sha as string | undefined) ||
    (analysis.coverage as any)?.commit_sha ||
    undefined;

  const hasEvidenceRecord = Boolean(
    analysis.coverage && typeof (analysis.coverage as any).run_id === "string",
  );

  const learnerMd = ((analysis as { learnerReport?: string | null }).learnerReport || "").trim();

  const proArticle = (
    <article className="bg-white text-slate-900 rounded-lg border border-slate-200 shadow-xs overflow-hidden max-w-4xl mx-auto">
      <header className="px-8 py-6 border-b border-slate-200 bg-white">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-500 mb-1">Debrief</p>
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Technical brief</h1>
        <p className="text-sm text-slate-600 mt-1 font-mono">{project.name}</p>
      </header>

      <div className="px-4 md:px-8">
        {sectionShell(
          "At a glance",
          <>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm mb-8">
              <div>
                <dt className="text-slate-500">Repository</dt>
                <dd className="font-medium text-slate-900">{project.name}</dd>
              </div>
              <div>
                <dt className="text-slate-500">URL</dt>
                <dd className="break-all">
                  <a href={project.url} className="text-slate-800 underline underline-offset-2 hover:text-slate-600">
                    {project.url}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Commit</dt>
                <dd className="font-mono text-slate-800">{commitSha || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Analyzed at</dt>
                <dd className="font-mono text-slate-800">{formatAnalysisTime(analysis)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Debrief version</dt>
                <dd className="font-mono text-slate-800">{DEBRIEF_VERSION}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-slate-500 sr-only">Evidence trail</dt>
                <dd>
                  {hasEvidenceRecord ? (
                    <span className="inline-flex items-center rounded-full border border-emerald-600/40 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                      Evidence trail recorded
                    </span>
                  ) : (
                    <span className="text-slate-500 text-sm">No evidence trail metadata for this run</span>
                  )}
                </dd>
              </div>
            </dl>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Summary</p>
            <p className="text-xl leading-relaxed text-slate-800 font-normal max-w-3xl">{summaryText}</p>
          </>,
        )}

        {sectionShell(
          "What we found",
          <>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Flagged patterns</p>
            {watchList.length === 0 ? (
              <p className="text-slate-600 mb-8">No patterns flagged</p>
            ) : (
              <ul className="space-y-3 list-none p-0 m-0 mb-8">
                {watchList.map((w, i) => (
                  <li key={i} className="flex gap-2 text-slate-800">
                    <span className="shrink-0 text-amber-700" aria-hidden={true}>
                      !
                    </span>
                    <span>
                      <span className="font-medium">{w.statement}</span>
                      {w.ref ? <span className="block text-sm text-slate-600 font-mono mt-1">{w.ref}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Gaps</p>
            {unknownsList.length === 0 ? (
              <p className="text-slate-600">No gaps detected</p>
            ) : (
              <ul className="space-y-3 list-none p-0 m-0">
                {unknownsList.map((u, i) => (
                  <li key={i} className="flex gap-2 text-slate-800">
                    <span className="shrink-0 text-slate-500" aria-hidden={true}>
                      ○
                    </span>
                    <span>{u}</span>
                  </li>
                ))}
              </ul>
            )}
          </>,
        )}

        {sectionShell(
          "How it runs",
          <>
            {anatomy.map((p, i) => (
              <p key={i} className="leading-relaxed text-slate-800">
                {p}
              </p>
            ))}
            <div className="mt-6">
              <Tabs defaultValue="dependencies" className="w-full">
                <TabsList className="grid w-full max-w-md grid-cols-2 bg-slate-100 p-1">
                  <TabsTrigger value="dependencies" className="text-xs sm:text-sm">
                    Dependencies
                  </TabsTrigger>
                  <TabsTrigger value="api" className="text-xs sm:text-sm">
                    API surface
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="dependencies" className="mt-4">
                  <DependencyInventoryPanel graph={dependencyGraph ?? undefined} />
                </TabsContent>
                <TabsContent value="api" className="mt-4">
                  <ApiSurfacePanel surface={apiSurface ?? undefined} />
                </TabsContent>
              </Tabs>
            </div>
          </>,
        )}

        {sectionShell(
          "Evidence",
          <>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-3 py-2 font-semibold">File / scope</th>
                    <th className="px-3 py-2 font-semibold">Hash (prefix)</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-200">
                      <td className="px-3 py-2 font-mono text-xs text-slate-800 break-all">{r.path}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">{r.hash}</td>
                      <td className="px-3 py-2 text-slate-700">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {evidenceSignature ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-600">Signature:</span>
                <code className="font-mono text-xs bg-slate-100 px-2 py-1 rounded text-slate-800">
                  {evidenceSignature.slice(0, 24)}…
                </code>
              </div>
            ) : null}
            <p className="text-xs text-slate-500 mt-4 leading-relaxed max-w-2xl">
              Findings are anchored to file:line evidence. Hashes verify snippet presence at time of analysis.
            </p>
            {projectId != null ? (
              <div className="mt-4 space-y-1">
                <p className="text-sm">
                  <Link
                    href={`/projects/${projectId}/verification${selectedRunId != null ? `?runId=${selectedRunId}` : ""}`}
                    className="font-medium text-slate-800 underline underline-offset-2 hover:text-slate-600"
                  >
                    Verification package (beta) →
                  </Link>
                </p>
                <p className="text-xs text-slate-500 max-w-xl leading-relaxed">
                  Export an evidence bundle and run a verification check. Packages use the{" "}
                  <strong className="font-medium text-slate-600">latest analysis Debrief has stored for this project</strong>
                  , not necessarily the run tab you have open.
                </p>
              </div>
            ) : null}
          </>,
        )}

        {sectionShell(
          "Suggestions",
          <>
            {tools.length === 0 ? (
              <p className="text-slate-600">No suggestions matched the gaps detected in this run.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {tools.map((t) => (
                  <a
                    key={t.name}
                    href={t.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 hover:border-slate-300 transition-colors block no-underline text-inherit"
                  >
                    <h3 className="font-semibold text-slate-900">{t.name}</h3>
                    <p className="text-sm text-slate-700 mt-1 leading-snug">{t.description}</p>
                    <p className="text-xs text-slate-500 mt-2 font-mono truncate">{t.href}</p>
                  </a>
                ))}
              </div>
            )}
          </>,
        )}
      </div>
    </article>
  );

  const historyBlock =
    projectId != null ? (
      <RunHistoryPanel projectId={projectId} reportAudience={reportAudience} selectedRunId={selectedRunId} />
    ) : null;

  const cacheBanner = cacheHit ? (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 text-sm">
      ⚡ Returned from cache — no changes since last run.
    </div>
  ) : null;

  const educationCta =
    projectId != null && educationRunId != null ? (
      <div className="rounded-xl border border-teal-200 bg-linear-to-r from-teal-50 to-cyan-50 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs">
        <p className="text-sm text-teal-950 font-medium leading-snug">
          See how Debrief turned this repository into your brief — from scan to saved results — in one visual walkthrough.
        </p>
        <Link href={`/education/${educationRunId}/chain`}>
          <Button
            type="button"
            className="shrink-0 bg-teal-700 hover:bg-teal-800 text-white gap-2"
            data-testid="education-chain-cta"
          >
            <Hexagon className="w-4 h-4" strokeWidth={2.25} aria-hidden />
            How this debrief was produced →
          </Button>
        </Link>
      </div>
    ) : null;

  if (!learnerMd) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        {cacheBanner}
        {educationCta}
        {historyBlock}
        {proArticle}
      </div>
    );
  }

  const defaultReportTab = reportAudience === "learner" ? "learner" : "pro";

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {cacheBanner}
      {educationCta}
      {historyBlock}
      <Tabs defaultValue={defaultReportTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2 bg-amber-100/80 border border-amber-200/90 p-1 h-auto">
          <TabsTrigger
            value="learner"
            className="data-[state=active]:bg-orange-100 data-[state=active]:text-orange-950 data-[state=active]:shadow-xs text-amber-950/90 rounded-md"
          >
            Plain-language brief
          </TabsTrigger>
          <TabsTrigger
            value="pro"
            className="data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-md"
          >
            Technical brief
          </TabsTrigger>
        </TabsList>
        <TabsContent value="learner" className="mt-4 focus-visible:outline-hidden">
          <article className="rounded-xl border border-amber-200/90 bg-linear-to-b from-amber-50 via-orange-50/50 to-amber-50/30 shadow-xs overflow-hidden text-amber-950">
            <header className="px-6 py-4 border-b border-amber-200/70 bg-orange-100/40">
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-800/90">Plain-language</p>
              <h2 className="text-xl font-semibold text-amber-950 mt-1">Plain-language debrief</h2>
              <p className="text-sm text-amber-900/85 mt-1 max-w-prose">
                Written for builders who are not diving into the technical dossier first — same analysis, warmer words.
              </p>
            </header>
            <div className="px-6 py-8 prose prose-stone max-w-none prose-headings:text-amber-950 prose-a:text-orange-800 prose-strong:text-amber-950 prose-li:marker:text-amber-700">
              <ReactMarkdown>{learnerMd}</ReactMarkdown>
            </div>
          </article>
        </TabsContent>
        <TabsContent value="pro" className="mt-4 focus-visible:outline-hidden">
          {proArticle}
        </TabsContent>
      </Tabs>
    </div>
  );
}
