import { useRoute, Link, useLocation } from "wouter";
import { useAnalysisStatus, useProjectRunDetail } from "@/hooks/use-projects";
import { Layout } from "@/components/layout";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DebriefReport } from "@/components/DebriefReport";
import { Loader2, AlertTriangle, ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useDebriefApiKey } from "@/contexts/DebriefApiKeyContext";
import { isOpenWeb } from "@/lib/openWeb";

export default function ProjectDetails() {
  const [match, params] = useRoute("/projects/:id");
  const [loc] = useLocation();
  const projectId = parseInt(params?.id || "0", 10);
  const { apiKey } = useDebriefApiKey();
  const hasApiAccess = isOpenWeb || Boolean(apiKey.trim());
  const { data, isPending, isError, error } = useAnalysisStatus(projectId);
  const selectedRunId = useMemo(() => {
    const q = loc.includes("?") ? loc.split("?")[1] : "";
    const p = new URLSearchParams(q);
    const v = p.get("runId");
    return v ? parseInt(v, 10) : null;
  }, [loc]);
  const runDetailQ = useProjectRunDetail(projectId, selectedRunId);
  const [rawOpen, setRawOpen] = useState(false);

  if (!hasApiAccess) {
    return (
      <Layout>
        <div className="max-w-lg mx-auto text-center py-20 px-4">
          <Card className="border-border">
            <CardContent className="pt-8 pb-8 space-y-4">
              <h2 className="text-lg font-semibold">API key required</h2>
              <p className="text-muted-foreground text-sm">
                An API key is required. Open Analyze (home), enter your key under Account, then run a debrief. Keys stay in memory for this session only.
              </p>
              <Link href="/">
                <Button variant="default">Go to home</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  if (!projectId || isNaN(projectId)) {
    return (
      <Layout>
        <div className="text-center py-20">
          <h2 className="text-xl font-bold">Invalid project</h2>
          <Link href="/">
            <span className="text-primary mt-4 inline-block cursor-pointer">Return home</span>
          </Link>
        </div>
      </Layout>
    );
  }

  if (isPending && !data) {
    return <LoadingScreen message="Loading project…" />;
  }

  if (isError) {
    return (
      <Layout>
        <div className="max-w-xl mx-auto py-16 px-4">
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="pt-8 pb-8 text-center space-y-2">
              <p className="text-destructive font-medium">{error?.message || "Something went wrong"}</p>
              <Link href="/">
                <span className="text-primary text-sm cursor-pointer">Return home</span>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const project = data?.project;
  const analysis =
    selectedRunId && runDetailQ.data?.analysis
      ? runDetailQ.data.analysis
      : data?.analysis;
  const cacheHit = Boolean(
    (runDetailQ.data?.run as { runMetadata?: { cache_hit?: boolean } } | undefined)?.runMetadata
      ?.cache_hit,
  );
  const runDetailLoading = Boolean(selectedRunId && runDetailQ.isPending);

  if (!project) {
    return (
      <Layout>
        <div className="text-center py-20">
          <h2 className="text-xl font-bold">Project not found</h2>
          <Link href="/projects">
            <span className="text-primary mt-4 inline-block cursor-pointer">Back to library</span>
          </Link>
        </div>
      </Layout>
    );
  }

  const waitingForAnalysis =
    project.status === "pending" ||
    project.status === "analyzing" ||
    (project.status === "completed" && !analysis);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex items-center gap-4">
          <Link href="/projects">
            <div
              className="p-2 rounded-full hover-elevate text-muted-foreground cursor-pointer"
              data-testid="link-back-projects"
            >
              <ArrowLeft className="w-5 h-5" />
            </div>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-display font-bold text-foreground" data-testid="text-project-name">
                {project.name}
              </h1>
              <StatusBadge status={project.status} />
            </div>
            <p className="text-sm text-muted-foreground font-mono mt-1" data-testid="text-project-url">
              {project.url}
            </p>
          </div>
        </div>

        {project.status === "failed" ? (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="pt-6 text-center text-destructive">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4" />
              <h3 className="text-lg font-bold mb-2">Analysis failed</h3>
              <p>Analysis failed — please check the repo URL and try again.</p>
            </CardContent>
          </Card>
        ) : waitingForAnalysis ? (
          <AnalyzingState />
        ) : analysis ? (
          <div className="space-y-8 pb-16">
            {runDetailLoading ? (
              <p className="text-sm text-muted-foreground font-mono">Loading selected run…</p>
            ) : null}
            <div className="flex justify-end">
              <Link href={`/projects/${project.id}/progress`}>
                <span className="text-sm text-primary cursor-pointer">View progress (beta)</span>
              </Link>
            </div>
            <DebriefReport
              project={{ name: project.name, url: project.url }}
              analysis={analysis}
              projectId={project.id}
              selectedRunId={selectedRunId}
              cacheHit={cacheHit}
              reportAudience={(project.reportAudience as "pro" | "learner" | undefined) ?? "pro"}
            />

            <div className="rounded-lg border border-border bg-secondary/10 overflow-hidden">
              <button
                type="button"
                onClick={() => setRawOpen(!rawOpen)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-mono text-muted-foreground hover:bg-secondary/30 transition-colors"
                data-testid="toggle-raw-data"
              >
                {rawOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                Developer details (raw JSON)
              </button>
              {rawOpen && (
                <pre
                  className={cn(
                    "text-xs font-mono p-4 border-t border-border overflow-auto max-h-[480px]",
                    "text-muted-foreground bg-background/80",
                  )}
                >
                  {JSON.stringify(analysis, null, 2)}
                </pre>
              )}
            </div>
          </div>
        ) : (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              <p>No analysis record found yet.</p>
              <Link href="/projects">
                <Button className="mt-4" variant="outline">
                                   Back to library
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <Layout>
      <div className="h-[60vh] flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
        <p className="text-muted-foreground font-mono animate-pulse">{message}</p>
      </div>
    </Layout>
  );
}

function AnalyzingState() {
  return (
    <div className="h-[480px] flex flex-col items-center justify-center text-center px-4">
      <Loader2 className="w-14 h-14 text-primary animate-spin mb-6" />
      <h2 className="text-xl font-display font-semibold mb-2 text-foreground">Debrief in progress…</h2>
      <p className="text-muted-foreground max-w-md">
        Running Debrief on your repo. This page updates automatically when your brief is ready.
      </p>
    </div>
  );
}
