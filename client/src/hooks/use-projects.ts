import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api, buildUrl } from "@shared/routes";
import { type Project, type Analysis } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useDebriefApiKey } from "@/contexts/DebriefApiKeyContext";

function authHeaders(apiKey: string): HeadersInit {
  const h: Record<string, string> = {};
  if (apiKey) h["X-Api-Key"] = apiKey;
  return h;
}

/** Polls project + analysis every 3s until analysis exists, project fails, or 5 minutes elapse. */
export function useAnalysisStatus(projectId: number) {
  const { apiKey } = useDebriefApiKey();
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
  }, [projectId]);

  const enabled = Number.isFinite(projectId) && projectId > 0 && !!apiKey;

  return useQuery({
    queryKey: ["analysisStatus", projectId, apiKey],
    enabled,
    queryFn: async (): Promise<{ project: Project; analysis: Analysis | null }> => {
      const hdr = authHeaders(apiKey);
      const pUrl = buildUrl(api.projects.get.path, { id: projectId });
      const pRes = await fetch(pUrl, { headers: hdr });
      if (pRes.status === 401) throw new Error("Invalid API key");
      if (pRes.status === 404) {
        return { project: null as unknown as Project, analysis: null };
      }
      if (!pRes.ok) throw new Error("Failed to load project");
      const project = (await pRes.json()) as Project;

      const aUrl = buildUrl(api.projects.getAnalysis.path, { id: projectId });
      const aRes = await fetch(aUrl, { headers: hdr });
      let analysis: Analysis | null = null;
      if (aRes.status === 200) {
        analysis = (await aRes.json()) as Analysis;
      } else if (aRes.status === 401) {
        throw new Error("Invalid API key");
      } else if (aRes.status !== 404) {
        throw new Error("Failed to load analysis");
      }

      const elapsed = Date.now() - startRef.current;
      if (
        elapsed > 5 * 60 * 1000 &&
        !analysis &&
        project.status !== "failed"
      ) {
        throw new Error("Analysis timed out after 5 minutes. Please try again.");
      }

      return { project, analysis };
    },
    refetchInterval: (query) => {
      if (!enabled) return false;
      if (query.state.error) return false;
      if (Date.now() - startRef.current > 5 * 60 * 1000) return false;
      const d = query.state.data;
      if (!d) return 3000;
      if (d.analysis) return false;
      if (d.project?.status === "failed") return false;
      return 3000;
    },
  });
}

// GET /api/projects
export function useProjects() {
  const { apiKey } = useDebriefApiKey();
  return useQuery({
    queryKey: [api.projects.list.path, apiKey],
    enabled: !!apiKey,
    queryFn: async () => {
      const res = await fetch(api.projects.list.path, { headers: authHeaders(apiKey) });
      if (res.status === 401) throw new Error("Invalid API key");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return api.projects.list.responses[200].parse(await res.json());
    },
  });
}

// GET /api/projects/:id
export function useProject(id: number) {
  const { apiKey } = useDebriefApiKey();
  return useQuery({
    queryKey: [api.projects.get.path, id, apiKey],
    enabled: !!id && id > 0 && !!apiKey,
    queryFn: async () => {
      const url = buildUrl(api.projects.get.path, { id });
      const res = await fetch(url, { headers: authHeaders(apiKey) });
      if (res.status === 404) return null;
      if (res.status === 401) throw new Error("Invalid API key");
      if (!res.ok) throw new Error("Failed to fetch project");
      return api.projects.get.responses[200].parse(await res.json());
    },
    refetchInterval: (query) => {
      const data = query.state.data as Project | undefined;
      if (data && (data.status === "pending" || data.status === "analyzing")) {
        return 2000;
      }
      return false;
    },
  });
}

// GET /api/projects/:id/analysis
export function useAnalysis(projectId: number) {
  const { apiKey } = useDebriefApiKey();
  return useQuery({
    queryKey: [api.projects.getAnalysis.path, projectId, apiKey],
    enabled: !!projectId && projectId > 0 && !!apiKey,
    queryFn: async () => {
      const url = buildUrl(api.projects.getAnalysis.path, { id: projectId });
      const res = await fetch(url, { headers: authHeaders(apiKey) });
      if (res.status === 404) return null;
      if (res.status === 401) throw new Error("Invalid API key");
      if (!res.ok) throw new Error("Failed to fetch analysis");
      return api.projects.getAnalysis.responses[200].parse(await res.json());
    },
  });
}

type CreateProjectInput = {
  url: string;
  name: string;
  /** Server accepts github | local | replit — use `github` for public GitHub repos */
  mode?: "github" | "local" | "replit";
  reportAudience?: "pro" | "learner";
  model?: string;
  apiKey: string;
};

export type CreateProjectResult =
  | { kind: "queued"; projectId: number; jobId: string }
  | { kind: "created"; project: Project };

// POST /api/projects — when BullMQ is enabled, server returns 202 + jobId; otherwise 201 + project.
export function useCreateProject() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateProjectInput): Promise<CreateProjectResult> => {
      const { apiKey, mode = "github", reportAudience = "pro", url, name, model } = input;
      const res = await fetch(api.projects.create.path, {
        method: api.projects.create.method,
        headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
        body: JSON.stringify({ url, name, mode, reportAudience, model }),
      });

      if (res.status === 202) {
        const body = (await res.json()) as { projectId?: unknown; jobId?: unknown };
        const projectId = Number(body.projectId);
        const jobId = typeof body.jobId === "string" ? body.jobId : String(body.jobId ?? "");
        if (!Number.isFinite(projectId) || !jobId) {
          throw new Error("Invalid async create response");
        }
        return { kind: "queued", projectId, jobId };
      }

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.projects.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        if (res.status === 401) throw new Error("Invalid API key");
        throw new Error("Failed to create project");
      }
      const project = api.projects.create.responses[201].parse(await res.json());
      return { kind: "created", project };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.projects.list.path] });
      toast({
        title: data.kind === "queued" ? "Analysis queued" : "Project created",
        description:
          data.kind === "queued" ? "Live progress below — you can leave this page open." : "Starting analysis…",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Request failed",
        description: error.message,
      });
    },
  });
}

export async function triggerProjectAnalysis(projectId: number, apiKey: string): Promise<void> {
  const url = buildUrl(api.projects.analyze.path, { id: projectId });
  const res = await fetch(url, {
    method: api.projects.analyze.method,
    headers: authHeaders(apiKey),
  });
  if (res.status === 401) throw new Error("Invalid API key");
  if (!res.ok && res.status !== 202) throw new Error("Failed to start analysis");
}

/** Clone hosted git URL (e.g. Replit) server-side, then analyze the temp checkout. */
export async function cloneAnalyzeProject(input: {
  gitUrl: string;
  name?: string;
  apiKey: string;
}): Promise<Project> {
  const { apiKey, gitUrl, name } = input;
  const res = await fetch(api.projects.cloneAnalyze.path, {
    method: api.projects.cloneAnalyze.method,
    headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
    body: JSON.stringify({ gitUrl, name }),
  });
  if (res.status === 401) throw new Error("Invalid API key");
  if (res.status === 400) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.message === "string" ? body.message : "Invalid clone URL");
  }
  if (!res.ok) throw new Error("Failed to start clone analysis");
  return api.projects.cloneAnalyze.responses[201].parse(await res.json());
}

export function useAnalyzeReplit() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { apiKey } = useDebriefApiKey();

  return useMutation({
    mutationFn: async (): Promise<Project> => {
      const res = await fetch(api.projects.analyzeReplit.path, {
        method: api.projects.analyzeReplit.method,
        headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
      });
      if (res.status === 401) throw new Error("Invalid API key");
      if (!res.ok) throw new Error("Failed to start Replit workspace analysis");
      const data = await res.json();
      return data as Project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.projects.list.path] });
      toast({
        title: "Workspace Analysis Started",
        description: "Scanning this Replit workspace...",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Workspace Analysis Failed",
        description: error.message,
      });
    },
  });
}

// POST /api/projects/:id/analyze (Manual trigger if needed)
export type ProjectRunListRow = {
  id: number;
  created_at: string | Date | null;
  mode: string;
  dci_score: number | null;
  claim_count: number | null;
  verified_count: number | null;
  input_type: string;
  model_used: string | null;
  cache_hit: boolean;
};

export function useProjectRuns(projectId: number) {
  const { apiKey } = useDebriefApiKey();
  return useQuery({
    queryKey: ["projectRuns", projectId, apiKey],
    enabled: Number.isFinite(projectId) && projectId > 0 && !!apiKey,
    queryFn: async (): Promise<ProjectRunListRow[]> => {
      const res = await fetch(`/api/projects/${projectId}/runs`, { headers: authHeaders(apiKey) });
      if (res.status === 401) throw new Error("Invalid API key");
      if (!res.ok) throw new Error("Failed to load runs");
      return (await res.json()) as ProjectRunListRow[];
    },
  });
}

export function useProjectRunDetail(projectId: number, runId: number | null) {
  const { apiKey } = useDebriefApiKey();
  return useQuery({
    queryKey: ["projectRunDetail", projectId, runId, apiKey],
    enabled: Number.isFinite(projectId) && projectId > 0 && !!runId && !!apiKey,
    queryFn: async (): Promise<{ run: Record<string, unknown>; analysis: Analysis | null }> => {
      const res = await fetch(`/api/projects/${projectId}/runs/${runId}`, { headers: authHeaders(apiKey) });
      if (res.status === 401) throw new Error("Invalid API key");
      if (res.status === 404) throw new Error("Run not found");
      if (!res.ok) throw new Error("Failed to load run");
      return res.json() as Promise<{ run: Record<string, unknown>; analysis: Analysis | null }>;
    },
  });
}

export function useTriggerAnalysis() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { apiKey } = useDebriefApiKey();

  return useMutation({
    mutationFn: async (id: number) => {
      await triggerProjectAnalysis(id, apiKey);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: [api.projects.get.path, id] });
      queryClient.invalidateQueries({ queryKey: ["analysisStatus", id] });
      toast({
        title: "Analysis Queued",
        description: "The system is processing the repository.",
      });
    },
  });
}
