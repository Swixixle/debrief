import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link, useLocation, useRoute } from "wouter";
import { useAuth } from "@clerk/clerk-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDebriefApiKey } from "@/contexts/DebriefApiKeyContext";
import { useAnalysisStatus } from "@/hooks/use-projects";
import { clerkPublishableKey } from "@/lib/clerkEnv";
import { isOpenWeb } from "@/lib/openWeb";

function authHeaders(apiKey: string): HeadersInit {
  const h: Record<string, string> = {};
  if (apiKey) h["X-Api-Key"] = apiKey;
  return h;
}

function stableKeyFingerprint(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return `k${Math.abs(h).toString(36)}`;
}

function tenantIdNoClerk(apiKey: string): string {
  if (apiKey.trim()) return `key:${stableKeyFingerprint(apiKey)}`;
  // Open-web deploys use one shared tenant id so anonymous users can hit the certificate APIs.
  // Packages listed under this tenant are not private to a single visitor — see on-page notice.
  if (isOpenWeb) return "open-web";
  return "local";
}

function ProjectVerificationWithClerkTenant() {
  const { userId } = useAuth();
  const { apiKey } = useDebriefApiKey();
  const tenantId = userId
    ? `clerk:${userId}`
    : apiKey.trim()
      ? `key:${stableKeyFingerprint(apiKey)}`
      : isOpenWeb
        ? "open-web"
        : // Clerk is configured but user is signed out and has no session key: avoid colliding with open-web.
          "clerk-signed-out";
  return <ProjectVerificationPage tenantId={tenantId} />;
}

export default function ProjectVerificationRoute() {
  const pk = clerkPublishableKey();
  if (pk) {
    return <ProjectVerificationWithClerkTenant />;
  }
  return <ProjectVerificationNoClerk />;
}

function ProjectVerificationNoClerk() {
  const { apiKey } = useDebriefApiKey();
  const tenantId = tenantIdNoClerk(apiKey);
  return <ProjectVerificationPage tenantId={tenantId} />;
}

type CertListRow = { id: string; analysis_id: number; issued_at: string | Date | null };

function ProjectVerificationPage({ tenantId }: { tenantId: string }) {
  const [match, params] = useRoute("/projects/:id/verification");
  const [loc] = useLocation();
  const projectId = parseInt(params?.id || "0", 10);
  const { apiKey } = useDebriefApiKey();
  const hasApiAccess = isOpenWeb || Boolean(apiKey.trim());
  const queryClient = useQueryClient();

  const runIdParam = (() => {
    const q = loc.includes("?") ? loc.split("?")[1] : "";
    const v = new URLSearchParams(q).get("runId");
    return v ? parseInt(v, 10) : null;
  })();

  const backHref =
    runIdParam != null && !Number.isNaN(runIdParam)
      ? `/projects/${projectId}?runId=${runIdParam}`
      : `/projects/${projectId}`;

  const statusQ = useAnalysisStatus(projectId);

  const certsQ = useQuery({
    queryKey: ["certificates-list", tenantId, projectId, apiKey, isOpenWeb],
    enabled: hasApiAccess && !!tenantId && projectId > 0,
    queryFn: async (): Promise<CertListRow[]> => {
      const res = await fetch(
        `/api/certificates?tenant_id=${encodeURIComponent(tenantId)}&limit=40`,
        { headers: authHeaders(apiKey), credentials: "include" },
      );
      if (res.status === 401) throw new Error("Unauthorized");
      if (!res.ok) throw new Error("Failed to load verification packages");
      const j = (await res.json()) as { certificates?: CertListRow[] };
      const rows = j.certificates ?? [];
      // Rows match POST bodies that send `analysisId: projectId`; the column is `analysis_id` but
      // holds that project id under the current API contract (see server certificate route comment).
      return rows.filter((c) => c.analysis_id === projectId);
    },
  });

  const createMut = useMutation({
    mutationFn: async (): Promise<{ certificate_id: string }> => {
      const res = await fetch("/api/certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
        credentials: "include",
        body: JSON.stringify({
          // Server: field name is legacy — value must be `projects.id`; see `getAnalysisByProjectId` in routes.
          analysisId: projectId,
          tenantId,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      return res.json() as Promise<{ certificate_id: string }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["certificates-list", tenantId, projectId, apiKey, isOpenWeb],
      });
    },
  });

  const [verifyState, setVerifyState] = useState<{
    certificateId: string;
    valid: boolean;
    errors: string[];
  } | null>(null);

  const verifyMut = useMutation({
    mutationFn: async (certificateId: string) => {
      const bundleRes = await fetch(`/api/certificates/${certificateId}/evidence-bundle.json`, {
        headers: authHeaders(apiKey),
        credentials: "include",
      });
      if (!bundleRes.ok) throw new Error("Could not download evidence bundle for verification check");
      const bundle = await bundleRes.json();
      const vRes = await fetch("/api/certificates/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bundle),
      });
      if (!vRes.ok) throw new Error("Verification check request failed");
      return vRes.json() as Promise<{ valid: boolean; errors?: string[] }>;
    },
    onSuccess: (data, certificateId) => {
      setVerifyState({ certificateId, valid: data.valid, errors: data.errors ?? [] });
    },
  });

  if (!match) {
    return null;
  }

  if (!hasApiAccess) {
    return (
      <Layout>
        <div className="max-w-lg mx-auto text-center py-20 px-4">
          <Card>
            <CardContent className="pt-8 pb-8 space-y-4">
              <h2 className="text-lg font-semibold">API key required</h2>
              <p className="text-muted-foreground text-sm">
                Add your key on Analyze (home), then return here. Keys stay in memory for this session only.
              </p>
              <Link href="/">
                <Button>Go to Analyze</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  if (!projectId || Number.isNaN(projectId)) {
    return (
      <Layout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Invalid project.</p>
          <Link href="/projects">
            <span className="text-primary mt-4 inline-block cursor-pointer">Back to library</span>
          </Link>
        </div>
      </Layout>
    );
  }

  if (statusQ.isPending && !statusQ.data) {
    return (
      <Layout>
        <div className="h-[40vh] flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Loading project…</p>
        </div>
      </Layout>
    );
  }

  if (statusQ.isError) {
    return (
      <Layout>
        <div className="max-w-xl mx-auto py-16 px-4 text-center">
          <p className="text-destructive">{statusQ.error?.message || "Something went wrong"}</p>
          <Link href="/projects">
            <Button variant="outline" className="mt-4">
              Back to library
            </Button>
          </Link>
        </div>
      </Layout>
    );
  }

  const project = statusQ.data?.project;
  const analysis = statusQ.data?.analysis;

  if (!project) {
    return (
      <Layout>
        <div className="text-center py-20">
          <p className="font-medium">Project not found</p>
          <Link href="/projects">
            <span className="text-primary mt-4 inline-block cursor-pointer">Back to library</span>
          </Link>
        </div>
      </Layout>
    );
  }

  const existing = certsQ.data ?? [];

  const downloadBundle = async (certificateId: string) => {
    const res = await fetch(`/api/certificates/${certificateId}/evidence-bundle.json`, {
      headers: authHeaders(apiKey),
      credentials: "include",
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debrief-evidence-${certificateId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-start gap-4">
          <Link href={backHref}>
            <div
              className="p-2 rounded-full hover:bg-muted text-muted-foreground cursor-pointer mt-0.5"
              aria-label="Back to report"
            >
              <ArrowLeft className="w-5 h-5" />
            </div>
          </Link>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Debrief · Beta</p>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">Verification package</h1>
            <p className="text-sm text-muted-foreground font-mono mt-1">{project.name}</p>
          </div>
        </div>

        {tenantId === "open-web" ? (
          <Card className="border-amber-200/90 bg-amber-50/50">
            <CardContent className="pt-4 pb-4 text-xs text-amber-950 leading-relaxed">
              <p className="font-medium text-amber-950">Open-web mode</p>
              <p className="mt-1">
                Verification packages use a <strong>shared demo tenant</strong>. Other visitors on this deployment may
                see or create packages under the same tenant id. Do not treat exports as private or as production-grade
                custody.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="pt-6 space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p className="text-foreground font-medium">What this is</p>
            <p>
              Debrief can issue a <strong className="text-foreground">verification package</strong>: a downloadable{" "}
              <strong className="text-foreground">evidence bundle</strong> (JSON) with a cryptographic signature. A{" "}
              <strong className="text-foreground">verification check</strong> re-validates that bundle (signature and
              content) using Debrief&apos;s public verifier — it confirms the file has not been tampered with after it
              was produced, not that every finding in the brief is correct in the real world.
            </p>
            <p>
              This is a practical way to share evidence next to a brief. It is{" "}
              <strong className="text-foreground">not</strong> legal advice, a notarized attestation, or a third-party
              certification.
            </p>
            <p className="rounded-md border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-amber-950 text-xs leading-relaxed">
              <strong className="text-amber-950">Stored analysis only:</strong> new packages always reflect the{" "}
              <strong>latest analysis row Debrief has stored for this project</strong>. The report&apos;s run tab is for
              reading; it does not, by itself, retarget the export to an older run under the current API.
            </p>
          </CardContent>
        </Card>

        {!analysis || project.status !== "completed" ? (
          <Card className="border-dashed">
            <CardContent className="pt-6 text-sm text-muted-foreground">
              <p>No completed analysis is available yet. Open the report and wait for the debrief to finish, then try again.</p>
              <Link href={backHref}>
                <Button variant="outline" className="mt-4">
                  Back to report
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Create a verification package</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Builds a new evidence bundle from the latest stored analysis for this project.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() => createMut.mutate()}
                  disabled={createMut.isPending}
                  className="shrink-0"
                >
                  {createMut.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Creating…
                    </>
                  ) : (
                    "Create verification package"
                  )}
                </Button>
              </div>

              {createMut.isError ? (
                <p className="text-sm text-destructive">{(createMut.error as Error).message}</p>
              ) : null}

              {createMut.isSuccess && createMut.data?.certificate_id ? (
                <p className="text-sm text-emerald-700">
                  Verification package created{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{createMut.data.certificate_id}</code>
                </p>
              ) : null}

              {certsQ.isError ? (
                <p className="text-sm text-destructive">Could not load verification packages for this tenant.</p>
              ) : certsQ.isPending ? (
                <p className="text-xs text-muted-foreground">Loading verification packages…</p>
              ) : existing.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No verification packages for this project in this tenant yet.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">Verification packages for this project</p>
                  <ul className="space-y-2 border rounded-md divide-y">
                    {existing.slice(0, 8).map((c) => (
                      <li key={c.id} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <code className="text-xs break-all">{c.id}</code>
                          <p className="text-xs text-muted-foreground">
                            {c.issued_at
                              ? new Date(c.issued_at).toLocaleString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "—"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 shrink-0">
                          <Button type="button" variant="outline" size="sm" onClick={() => void downloadBundle(c.id)}>
                            Download evidence bundle
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setVerifyState(null);
                              verifyMut.reset();
                              verifyMut.mutate(c.id);
                            }}
                            disabled={verifyMut.isPending}
                          >
                            {verifyMut.isPending && verifyMut.variables === c.id
                              ? "Running check…"
                              : "Run verification check"}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {verifyMut.isError ? (
                <p className="text-sm text-destructive">{(verifyMut.error as Error).message}</p>
              ) : null}

              {verifyState && !verifyMut.isPending ? (
                <div
                  className={`rounded-md border px-3 py-2 text-sm ${
                    verifyState.valid
                      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                      : "border-destructive/40 bg-destructive/5 text-destructive"
                  }`}
                >
                  <p className="font-medium">
                    {verifyState.valid ? "Verification check passed" : "Verification check did not pass"}
                    {verifyState.certificateId ? (
                      <span className="font-normal text-muted-foreground ml-1 font-mono text-xs">
                        ({verifyState.certificateId.slice(0, 8)}…)
                      </span>
                    ) : null}
                  </p>
                  {!verifyState.valid && verifyState.errors.length > 0 ? (
                    <ul className="mt-2 list-disc pl-5 text-xs space-y-1">
                      {verifyState.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
