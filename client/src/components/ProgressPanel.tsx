import { useEffect, useRef, useState } from "react";
import { useTauriNotify } from "@/hooks/useTauriNotify";

export interface ProgressState {
  progress: number;
  message: string;
  cached?: boolean;
  error?: string;
  result?: unknown;
}

export function ProgressPanel({
  jobId,
  projectId,
  projectLabel,
  onDone,
}: {
  jobId: string;
  projectId: number;
  projectLabel?: string;
  onDone?: () => void;
}) {
  const [state, setState] = useState<ProgressState>({
    progress: 0,
    message: "Preparing…",
  });
  const { notify, setTrayStatus } = useTauriNotify();

  useEffect(() => {
    void setTrayStatus(`Debrief — analyzing${projectLabel ? `: ${projectLabel}` : ""}…`);
  }, [projectLabel, setTrayStatus]);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/ws?jobId=${encodeURIComponent(jobId)}`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (e) => {
      try {
        setState(JSON.parse(e.data as string) as ProgressState);
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [jobId]);

  const firedDone = useRef(false);
  useEffect(() => {
    if (state.progress < 0) {
      void setTrayStatus("Debrief — ready");
      return;
    }
    if (state.progress < 100 || firedDone.current) return;
    firedDone.current = true;
    const label = projectLabel || `project #${projectId}`;
    void notify("Debrief", `${label} is ready`);
    void setTrayStatus("Debrief — ready");
    onDone?.();
  }, [state.progress, onDone, notify, setTrayStatus, projectLabel, projectId]);

  const widthPct = state.progress < 0 ? 100 : Math.min(100, Math.max(0, state.progress));

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Progress</p>
      <p className="mt-2 text-sm text-slate-800">{state.message}</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            state.progress < 0 ? "bg-red-500" : "bg-slate-900"
          }`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <p className="mt-2 text-xs tabular-nums text-slate-500">
        {state.progress < 0 ? "—" : `${Math.round(state.progress)}%`}
      </p>
      {state.error && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {state.error}
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Project #{projectId}
        {projectLabel ? ` · ${projectLabel}` : ""}
      </p>
    </div>
  );
}
