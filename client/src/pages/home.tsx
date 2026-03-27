import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useCreateProject, triggerProjectAnalysis, cloneAnalyzeProject } from "@/hooks/use-projects";
import { Layout } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Mic, Upload } from "lucide-react";
import { useDebriefApiKey } from "@/contexts/DebriefApiKeyContext";
import { matchCloneAnalyzeUrl } from "@shared/cloneAnalyzeUrl";

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
  const [reportAudience, setReportAudience] = useState<"pro" | "learner">("pro");
  const [ingestHint, setIngestHint] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const cloneMatch = useMemo(() => matchCloneAnalyzeUrl(repoUrl), [repoUrl]);

  const syncKeyToContext = () => {
    setApiKey(apiKeyInput);
  };

  const postIngestAnalyze = useCallback(
    async (ingest: Record<string, string>, displayHint: string) => {
      const key = apiKeyInput.trim();
      if (!key) {
        setInlineError("An API key is required. Contact us to get access.");
        return;
      }
      syncKeyToContext();
      setSubmitting(true);
      setIngestHint(displayHint);
      setInlineError(null);
      try {
        const res = await fetch("/api/ingest/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Api-Key": key },
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
    [apiKeyInput, label, reportAudience, setApiKey, setLocation],
  );

  const uploadBlobAnalyze = useCallback(
    async (blob: Blob, kind: "zip" | "audio", hint: string) => {
      const key = apiKeyInput.trim();
      if (!key) {
        setInlineError("An API key is required. Contact us to get access.");
        return;
      }
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
        const res = await fetch("/api/ingest/analyze-upload", {
          method: "POST",
          headers: { "X-Api-Key": key },
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
    [apiKeyInput, label, reportAudience, setApiKey, setLocation],
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
    const key = apiKeyInput.trim();
    if (!key) {
      setInlineError("An API key is required.");
      return;
    }
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
      setIngestHint("🔗 URL pasted — choose Run Debrief or a specialized import.");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const handleCloneAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);
    const key = apiKeyInput.trim();
    if (!key) {
      setInlineError("An API key is required. Contact us to get access.");
      return;
    }
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
        apiKey: key,
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
    const key = apiKeyInput.trim();
    if (!key) {
      setInlineError("An API key is required. Contact us to get access.");
      return;
    }
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
      const project = await createProject.mutateAsync({
        url: normalizedUrl,
        name,
        mode: "github",
        reportAudience,
        apiKey: key,
      });
      await triggerProjectAnalysis(project.id, key);
      setLocation(`/projects/${project.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setInlineError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout variant="light">
      <div className="max-w-3xl mx-auto text-center px-4">
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-slate-900 leading-tight">
          Know exactly what you&apos;re working with.
        </h1>
        <p className="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl mx-auto">
          Debrief analyzes any codebase and produces a signed, evidence-anchored brief you can act on.
        </p>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
          <ValueProp text="30 minutes. Not 30 days." />
          <ValueProp text="Plain language. Not developer jargon." />
          <ValueProp text={'Signed evidence. Not someone\'s opinion.'} />
        </div>

        <div className="mt-16 rounded-2xl border border-slate-200 bg-slate-50/80 p-8 md:p-10 text-left shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">Settings</p>
          <Label htmlFor="api-key" className="text-slate-800 text-sm font-medium">
            Enter your API key to get started
          </Label>
          <Input
            id="api-key"
            type="password"
            autoComplete="off"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            className="mt-2 h-11 bg-white border-slate-300 text-slate-900"
            placeholder="Your API key"
          />
          {!apiKeyInput.trim() && (
            <p className="mt-2 text-sm text-slate-600">An API key is required. Contact us to get access.</p>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            <div>
              <p className="text-slate-800 text-sm font-medium mb-2">Report style</p>
              <div
                className="flex rounded-lg border border-slate-300 bg-white p-1 max-w-md"
                role="group"
                aria-label="Report style"
              >
                <button
                  type="button"
                  onClick={() => setReportAudience("pro")}
                  className={`flex-1 rounded-md py-2 px-3 text-sm font-medium transition-colors ${
                    reportAudience === "pro"
                      ? "bg-slate-900 text-white shadow"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Pro Report
                </button>
                <button
                  type="button"
                  onClick={() => setReportAudience("learner")}
                  className={`flex-1 rounded-md py-2 px-3 text-sm font-medium transition-colors ${
                    reportAudience === "learner"
                      ? "bg-amber-700 text-white shadow"
                      : "text-slate-700 hover:bg-amber-50/80"
                  }`}
                >
                  Learner Report
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                Learner adds a plain-language coach file alongside the full technical outputs.
              </p>
            </div>
            <div
              className="rounded-xl border-2 border-dashed border-slate-300 bg-white/60 px-4 py-6 text-center text-sm text-slate-600"
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
              <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" aria-hidden />
              <p className="font-medium text-slate-800">Drop files here</p>
              <p className="mt-1 text-xs">
                .zip · audio (.mp3, .m4a, .wav, .webm) · README (.md / .txt). Full folders: use the Debrief desktop app
                (Tauri) or zip the project first.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-slate-300"
                  onClick={() => void toggleMic()}
                  disabled={submitting}
                >
                  <Mic className="w-4 h-4 mr-2" aria-hidden />
                  {recording ? "Stop & analyze" : "Record voice"}
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="repo-url" className="text-slate-800 text-sm font-medium">
                Repository URL
              </Label>
              <Input
                id="repo-url"
                data-testid="input-github-url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/username/repo or https://replit.com/@user/repl"
                className="mt-2 h-12 text-base bg-white border-slate-300 text-slate-900"
              />
              {cloneMatch && (
                <p className="mt-2 text-sm text-slate-600">
                  Replit repl detected — use <strong>Clone &amp; Analyze</strong> to clone via git and run the analyzer on the checkout.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="repo-label" className="text-slate-800 text-sm font-medium">
                Name / label
              </Label>
              <Input
                id="repo-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="My project"
                className="mt-2 h-12 text-base bg-white border-slate-300 text-slate-900"
              />
            </div>

            {ingestHint && (
              <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{ingestHint}</p>
            )}

            {inlineError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">
                {inlineError}
              </p>
            )}

            <Button
              type="submit"
              data-testid={cloneMatch ? "button-clone-analyze" : "button-run-debrief"}
              disabled={submitting || (!cloneMatch && createProject.isPending)}
              className="w-full h-12 text-base font-semibold bg-slate-900 text-white hover:bg-slate-800"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {cloneMatch ? "Cloning and analyzing…" : "Running Debrief on your repo…"}
                </span>
              ) : cloneMatch ? (
                "Clone & Analyze"
              ) : (
                "Run Debrief"
              )}
            </Button>
          </form>
        </div>

        <p className="mt-8 text-sm text-slate-500">
          Supports public GitHub repositories and Replit repls (git clone on the server).
        </p>
      </div>
    </Layout>
  );
}

function ValueProp({ text }: { text: string }) {
  return (
    <p className="text-base md:text-lg font-medium text-slate-800 leading-snug border-l-4 border-slate-300 pl-4">
      {text}
    </p>
  );
}
