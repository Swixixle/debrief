import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProgressPanel } from "@/components/ProgressPanel";
import { useLocation } from "wouter";
import { useCreateProject, triggerProjectAnalysis, cloneAnalyzeProject } from "@/hooks/use-projects";
import { Layout } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, ChevronDown, Mic, Sparkles, Upload } from "lucide-react";
import { useDebriefApiKey } from "@/contexts/DebriefApiKeyContext";
import { matchCloneAnalyzeUrl } from "@shared/cloneAnalyzeUrl";
import { isOpenWeb } from "@/lib/openWeb";

const EXAMPLE_REPOS = [
  { label: "FastAPI", url: "https://github.com/fastapi/fastapi" },
  { label: "Express", url: "https://github.com/expressjs/express" },
  { label: "SQLModel", url: "https://github.com/tiangolo/sqlmodel" },
] as const;

const LEARNER_VALUE_PROPS = [
  "Start with a question, not a dashboard.",
  "Drop a repo, zip, or voice note — we'll meet you there.",
  "One next move when you're ready — not a wall of options.",
] as const;

const PRO_VALUE_PROPS = [
  "30 minutes. Not 30 days.",
  "Evidence at file:line — VERIFIED / INFERRED / UNKNOWN.",
  "Signed receipts — not opinions.",
] as const;

function validateRepoUrl(url: string): string | null {
  const t = url.trim();
  if (!t) return "Enter a GitHub repository URL.";
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return "That doesn't look like a valid URL.";
  }
  const host = u.hostname.replace(/^www\./i, "");
  if (host !== "github.com") return "Only github.com URLs are supported.";
  const parts = u.pathname.replace(/^\/|\/$/g, "").split("/").filter(Boolean);
  if (parts.length < 2) return "Use a URL like https://github.com/username/repo";
  return null;
}

function normalizeRepoUrl(url: string): string {
  const u = new URL(url.trim());
  const parts = u.pathname.replace(/^\/|\/$/g, "").split("/").filter(Boolean);
  return `https://github.com/${parts[0]}/${parts[1]}`;
}

export default function Home() {
  const [repoUrl, setRepoUrl] = useState("");
  const [label, setLabel] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const { setApiKey } = useDebriefApiKey();
  const [, setLocation] = useLocation();
  const createProject = useCreateProject();
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reportAudience, setReportAudience] = useState<"pro" | "learner">("learner");
  const [ingestHint, setIngestHint] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [queuedJob, setQueuedJob] = useState<{
    projectId: number;
    jobId: string;
    label: string;
  } | null>(null);
  const [keySectionOpen, setKeySectionOpen] = useState(() => !isOpenWeb);

  const needsUserApiKey = !isOpenWeb;

  const goToProject = useCallback(
    (id: number) => {
      setQueuedJob(null);
      setLocation(`/projects/${id}`);
    },
    [setLocation],
  );

  const cloneMatch = useMemo(() => matchCloneAnalyzeUrl(repoUrl), [repoUrl]);

  const syncKeyToContext = () => {
    if (apiKeyInput.trim()) setApiKey(apiKeyInput);
  };

  const assertApiAccess = useCallback((): boolean => {
    if (!needsUserApiKey) return true;
    if (!apiKeyInput.trim()) {
      setInlineError("Add your API key below (or open the Advanced section).");
      setKeySectionOpen(true);
      return false;
    }
    return true;
  }, [apiKeyInput, needsUserApiKey]);

  const effectiveKey = needsUserApiKey ? apiKeyInput.trim() : "";

  const postIngestAnalyze = useCallback(
    async (ingest: Record<string, string>, displayHint: string) => {
      if (!assertApiAccess()) return;
      syncKeyToContext();
      setSubmitting(true);
      setIngestHint(displayHint);
      setInlineError(null);
      try {
        const res = await fetch("/api/ingest/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(effectiveKey ? { "X-Api-Key": effectiveKey } : {}) },
          body: JSON.stringify({
            ingest,
            name: label.trim() || "Debrief import",
            reportAudience,
          }),
        });
        if (res.status === 401) throw new Error("Invalid API key");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(typeof body.message === "string" ? body.message : "Import failed");
        }
        const data = (await res.json()) as { projectId: number };
        setLocation(`/projects/${data.projectId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import failed.";
        setInlineError(message);
      } finally {
        setSubmitting(false);
        setIngestHint(null);
      }
    },
    [assertApiAccess, effectiveKey, label, reportAudience, setLocation],
  );

  const uploadBlobAnalyze = useCallback(
    async (blob: Blob, kind: "zip" | "audio", hint: string) => {
      if (!assertApiAccess()) return;
      syncKeyToContext();
      setSubmitting(true);
      setIngestHint(hint);
      setInlineError(null);
      try {
        const fd = new FormData();
        const ext = kind === "zip" ? "zip" : "webm";
        fd.append("file", blob, `upload.${ext}`);
        fd.append("kind", kind);
        fd.append("name", label.trim() || (kind === "audio" ? "Voice note" : "Archive"));
        fd.append("reportAudience", reportAudience);
        const headers: HeadersInit = {};
        if (effectiveKey) headers["X-Api-Key"] = effectiveKey;
        const res = await fetch("/api/ingest/analyze-upload", {
          method: "POST",
          headers,
          body: fd,
        });
        if (res.status === 401) throw new Error("Invalid API key");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(typeof body.message === "string" ? body.message : "Upload failed");
        }
        const data = (await res.json()) as { projectId: number };
        setLocation(`/projects/${data.projectId}`);
      } catch (err) {
        setInlineError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setSubmitting(false);
        setIngestHint(null);
      }
    },
    [assertApiAccess, effectiveKey, label, reportAudience, setLocation],
  );

  const handleDataTransferFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      const file = list[0];
      const name = file.name.toLowerCase();
      if (name.endsWith(".zip")) {
        setIngestHint("📦 Zip archive detected — extracting on server…");
        await uploadBlobAnalyze(file, "zip", "📦 Zip archive detected — unpacking…");
        return;
      }
      if (/\.(mp3|m4a|wav|webm|ogg)$/i.test(name)) {
        await uploadBlobAnalyze(file, "audio", "🎙️ Audio detected — transcribing with Whisper…");
        return;
      }
      if (name.endsWith(".md") || name.endsWith(".txt")) {
        const text = await file.text();
        await postIngestAnalyze({ type: "text", content: text }, "📄 Text description detected");
        return;
      }
      setInlineError("Drop a .zip, audio file, or .md/.txt — or use the desktop app for full folders.");
    },
    [postIngestAnalyze, uploadBlobAnalyze],
  );

  const toggleMic = async () => {
    if (recording && mediaRef.current) {
      mediaRef.current.stop();
      setRecording(false);
      return;
    }
    if (!assertApiAccess()) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      mediaRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];
        mediaRef.current = null;
        await uploadBlobAnalyze(blob, "audio", "🎙️ Transcribing your voice note…");
      };
      rec.start();
      setRecording(true);
      setIngestHint("🎙️ Recording… tap Stop when finished.");
    } catch {
      setInlineError("Microphone permission denied or unavailable.");
    }
  };

  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      const t = ev.clipboardData?.getData("text")?.trim();
      if (!t || !/^https?:\/\//i.test(t)) return;
      ev.preventDefault();
      setRepoUrl(t);
      setIngestHint("🔗 URL pasted — run Debrief or drop a file.");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const handleCloneAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);
    if (!assertApiAccess()) return;
    if (!cloneMatch) {
      setInlineError("Enter a Replit repl URL (https://replit.com/@username/repl).");
      return;
    }
    syncKeyToContext();
    const name = label.trim() || `Replit ${cloneMatch.label}`;

    setSubmitting(true);
    try {
      const project = await cloneAnalyzeProject({
        gitUrl: cloneMatch.cloneUrl,
        name,
        apiKey: effectiveKey,
      });
      setLocation(`/projects/${project.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setInlineError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cloneMatch) {
      return handleCloneAnalyze(e);
    }
    setInlineError(null);
    if (!assertApiAccess()) return;
    syncKeyToContext();
    const name = label.trim() || repoUrl.trim().split("/").filter(Boolean).pop() || "Repository";
    const urlErr = validateRepoUrl(repoUrl);
    if (urlErr) {
      setInlineError(urlErr);
      return;
    }
    const normalizedUrl = normalizeRepoUrl(repoUrl);

    setSubmitting(true);
    try {
      const out = await createProject.mutateAsync({
        url: normalizedUrl,
        name,
        mode: "github",
        reportAudience,
        apiKey: effectiveKey,
      });
      if (out.kind === "queued") {
        setQueuedJob({ projectId: out.projectId, jobId: out.jobId, label: name });
        return;
      }
      await triggerProjectAnalysis(out.project.id, effectiveKey);
      goToProject(out.project.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setInlineError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const valueProps = reportAudience === "learner" ? LEARNER_VALUE_PROPS : PRO_VALUE_PROPS;

  return (
    <Layout>
      <div
        className="max-w-3xl mx-auto text-center px-4 pb-16"
        data-audience={reportAudience}
      >
        <div className="flex flex-col items-center gap-3 mb-6">
          {!submitting && !recording && (
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest text-primary">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Debrief — Ready
            </div>
          )}
        </div>

        <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight text-foreground leading-tight">
          {reportAudience === "learner" ? "What did you build?" : "Know exactly what you're shipping."}
        </h1>
        <p className="mt-5 text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
          {reportAudience === "learner"
            ? "Debrief reads your project and tells you, in plain language, what's working — and your one clear next step."
            : "Debrief analyzes any codebase and produces a signed, evidence-anchored brief you can act on."}
        </p>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          {valueProps.map((text) => (
            <ValueProp key={text} text={text} />
          ))}
        </div>

        <div className="mt-14 rounded-2xl border border-border bg-card/80 p-8 md:p-10 text-left shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-2 text-primary mb-6">
            <Sparkles className="w-5 h-5 shrink-0" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-wider">Run a debrief</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {queuedJob && (
              <ProgressPanel
                jobId={queuedJob.jobId}
                projectId={queuedJob.projectId}
                projectLabel={queuedJob.label}
                onDone={() => goToProject(queuedJob.projectId)}
              />
            )}

            <div>
              <p className="text-foreground text-sm font-medium mb-2">Report style</p>
              <div
                className="flex rounded-lg border border-border bg-background/60 p-1 max-w-md"
                role="group"
                aria-label="Report style"
              >
                <button
                  type="button"
                  onClick={() => setReportAudience("learner")}
                  className={`flex-1 rounded-md py-2.5 px-3 text-sm font-medium transition-colors ${
                    reportAudience === "learner"
                      ? "bg-primary text-primary-foreground shadow"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  Learner
                </button>
                <button
                  type="button"
                  onClick={() => setReportAudience("pro")}
                  className={`flex-1 rounded-md py-2.5 px-3 text-sm font-medium transition-colors ${
                    reportAudience === "pro"
                      ? "bg-primary text-primary-foreground shadow"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  Pro
                </button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {reportAudience === "learner"
                  ? "Warm, jargon-light coach output — best for your first runs."
                  : "Full dossier, claims, and verified receipts for teams & diligence."}
              </p>
            </div>

            {/* Voice — prominent */}
            <div className="rounded-xl border-2 border-primary/40 bg-primary/5 px-5 py-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="text-left">
                  <p className="font-display font-semibold text-foreground text-lg">Talk through what you made</p>
                  <p className="mt-1 text-sm text-muted-foreground max-w-md">
                    Record a short voice note — we transcribe and analyze it like any other input.
                  </p>
                </div>
                <Button
                  type="button"
                  size="lg"
                  variant={recording ? "destructive" : "default"}
                  className={`shrink-0 h-12 px-6 font-semibold ${!recording ? "bg-primary text-primary-foreground hover:opacity-90" : ""}`}
                  onClick={() => void toggleMic()}
                  disabled={submitting}
                >
                  <Mic className="w-5 h-5 mr-2" aria-hidden />
                  {recording ? "Stop & analyze" : "Record voice"}
                </Button>
              </div>
            </div>

            <div
              className="rounded-xl border-2 border-dashed border-border bg-background/40 px-4 py-8 text-center text-sm text-muted-foreground"
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleDataTransferFiles(e.dataTransfer.files);
              }}
            >
              <Upload className="w-10 h-10 mx-auto text-primary/80 mb-3" aria-hidden />
              <p className="font-medium text-foreground text-base">Drop files here</p>
              <p className="mt-1 text-xs max-w-lg mx-auto">
                .zip · audio (.mp3, .m4a, .wav, .webm) · README (.md / .txt). Full folders: zip the project or use the
                desktop app.
              </p>
            </div>

            <div>
              <Label htmlFor="repo-url" className="text-foreground text-sm font-medium">
                Repository URL
              </Label>
              <Input
                id="repo-url"
                data-testid="input-github-url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/username/repo or https://replit.com/@user/repl"
                className="mt-2 h-12 text-base bg-background border-border"
              />
              <div className="mt-3 flex flex-wrap gap-2 justify-start">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground w-full sm:w-auto sm:mr-1">
                  Try an example
                </span>
                {EXAMPLE_REPOS.map((ex) => (
                  <button
                    key={ex.url}
                    type="button"
                    className="rounded-full border border-border bg-background/80 px-3 py-1 text-xs font-medium text-foreground hover:border-primary/50 hover:bg-primary/10 transition-colors"
                    onClick={() => {
                      setRepoUrl(ex.url);
                      setInlineError(null);
                    }}
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
              {cloneMatch && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Replit repl detected — use <strong className="text-foreground">Run Debrief</strong> to clone via git and
                  analyze the checkout.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="repo-label" className="text-foreground text-sm font-medium">
                Name / label <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="repo-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="My project"
                className="mt-2 h-12 text-base bg-background border-border"
              />
            </div>

            {needsUserApiKey && (
              <Collapsible open={keySectionOpen} onOpenChange={setKeySectionOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-background/50 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted/30"
                  >
                    API key <span className="text-muted-foreground font-normal">(required for this deployment)</span>
                    <ChevronDown
                      className={`w-4 h-4 shrink-0 transition-transform ${keySectionOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 space-y-2">
                  <Input
                    id="api-key"
                    type="password"
                    autoComplete="off"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="h-11 bg-background border-border"
                    placeholder="Your API key"
                  />
                  <p className="text-xs text-muted-foreground">
                    When this server runs in open mode, no key is needed on the public home page.
                  </p>
                </CollapsibleContent>
              </Collapsible>
            )}

            {ingestHint && (
              <p className="text-sm text-primary-foreground bg-primary/20 border border-primary/30 rounded-lg px-3 py-2">
                {ingestHint}
              </p>
            )}

            {inlineError && (
              <p className="text-sm text-destructive-foreground bg-destructive/15 border border-destructive/30 rounded-lg px-3 py-2" role="alert">
                {inlineError}
              </p>
            )}

            <Button
              type="submit"
              data-testid={cloneMatch ? "button-clone-analyze" : "button-run-debrief"}
              disabled={submitting || (!cloneMatch && createProject.isPending)}
              className="w-full h-12 text-base font-semibold bg-primary text-primary-foreground hover:opacity-90 gap-2"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {cloneMatch ? "Cloning and analyzing…" : "Running Debrief…"}
                </span>
              ) : cloneMatch ? (
                "Clone & analyze"
              ) : (
                "Run Debrief"
              )}
            </Button>
          </form>
        </div>

        <p className="mt-8 text-sm text-muted-foreground">
          Public GitHub repos and Replit repls (server-side git clone). Open web mode:{" "}
          {isOpenWeb ? "on — jump in with no API key." : "off — add a key under Advanced."}
        </p>
      </div>
    </Layout>
  );
}

function ValueProp({ text }: { text: string }) {
  return (
    <p className="text-base md:text-lg font-medium text-foreground/95 leading-snug border-l-4 border-primary/50 pl-4">
      {text}
    </p>
  );
}
