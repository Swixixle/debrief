import { db } from "./db";
import { pool } from "./db";
import {
  projects,
  analyses,
  runs,
  ciRuns,
  ciJobs,
  webhookDeliveries,
  certificates,
  type InsertProject,
  type InsertAnalysis,
  type Project,
  type Analysis,
  type RunRow,
  type CiRun,
  type InsertCiRun,
  type CiJob,
  type Certificate,
  type InsertCertificate,
} from "@shared/schema";
import { eq, desc, and, or, lt, asc, sql } from "drizzle-orm";

export interface IStorage {
  createProject(project: InsertProject, mode?: string): Promise<Project>;
  getProjects(): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createAnalysis(analysis: InsertAnalysis): Promise<Analysis>;
  getAnalysisByProjectId(projectId: number): Promise<Analysis | undefined>;
  updateProjectStatus(id: number, status: string): Promise<Project>;
  resetAnalyzerLogbook(): Promise<void>;

  checkAndRecordDelivery(deliveryId: string, event: string, repoOwner?: string, repoName?: string): Promise<boolean>;
  createCiRun(run: InsertCiRun): Promise<CiRun>;
  getCiRuns(owner: string, repo: string, limit?: number): Promise<CiRun[]>;
  getCiRun(id: string): Promise<CiRun | undefined>;
  updateCiRun(id: string, data: Partial<CiRun>): Promise<CiRun>;
  findExistingCiRun(owner: string, repo: string, sha: string, withinHours?: number): Promise<CiRun | undefined>;
  createCiJob(runId: string): Promise<CiJob>;
  leaseNextJob(): Promise<{ job: CiJob; run: CiRun } | null>;
  completeJob(jobId: string, status: "DONE" | "DEAD", error?: string): Promise<void>;
  getCiJobCounts(): Promise<Record<string, number>>;
  getLastCompletedRun(): Promise<CiRun | undefined>;

  createCertificate(certificate: InsertCertificate): Promise<Certificate>;
  getCertificate(id: string): Promise<Certificate | undefined>;
  getCertificatesByAnalysisId(analysisId: number): Promise<Certificate[]>;
  getCertificatesByTenantId(tenantId: string, limit?: number): Promise<Certificate[]>;

  insertRun(row: typeof runs.$inferInsert): Promise<RunRow>;
  listRunsForProject(projectId: number, limit?: number): Promise<RunRow[]>;
  getProjectRun(projectId: number, runId: number): Promise<RunRow | undefined>;
  getAnalysisById(id: number): Promise<Analysis | undefined>;
}

export class DatabaseStorage implements IStorage {
  async createProject(insertProject: InsertProject, mode: string = "github"): Promise<Project> {
    const [project] = await db.insert(projects).values({ ...insertProject, mode }).returning();
    return project;
  }

  async getProjects(): Promise<Project[]> {
    return await db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async getProject(id: number): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async createAnalysis(insertAnalysis: InsertAnalysis): Promise<Analysis> {
    const [analysis] = await db.insert(analyses).values(insertAnalysis).returning();
    return analysis;
  }

  async getAnalysisByProjectId(projectId: number): Promise<Analysis | undefined> {
    const [analysis] = await db.select().from(analyses).where(eq(analyses.projectId, projectId)).orderBy(desc(analyses.createdAt)).limit(1);
    return analysis;
  }

  async updateProjectStatus(id: number, status: string): Promise<Project> {
    const [project] = await db.update(projects).set({ status }).where(eq(projects.id, id)).returning();
    return project;
  }

  async resetAnalyzerLogbook(): Promise<void> {
    await db.delete(analyses);
    await db.delete(projects);
  }

  async checkAndRecordDelivery(deliveryId: string, event: string, repoOwner?: string, repoName?: string): Promise<boolean> {
    try {
      await db.insert(webhookDeliveries).values({
        deliveryId,
        event,
        repoOwner: repoOwner || null,
        repoName: repoName || null,
      });
      return true;
    } catch (err: any) {
      if (err?.code === "23505") {
        return false;
      }
      throw err;
    }
  }

  async createCiRun(run: InsertCiRun): Promise<CiRun> {
    const [created] = await db.insert(ciRuns).values(run).returning();
    return created;
  }

  async getCiRuns(owner: string, repo: string, limit: number = 50): Promise<CiRun[]> {
    return await db.select().from(ciRuns)
      .where(and(eq(ciRuns.repoOwner, owner), eq(ciRuns.repoName, repo)))
      .orderBy(desc(ciRuns.createdAt))
      .limit(limit);
  }

  async getCiRun(id: string): Promise<CiRun | undefined> {
    const [run] = await db.select().from(ciRuns).where(eq(ciRuns.id, id));
    return run;
  }

  async updateCiRun(id: string, data: Partial<CiRun>): Promise<CiRun> {
    const [updated] = await db.update(ciRuns).set(data).where(eq(ciRuns.id, id)).returning();
    return updated;
  }

  async findExistingCiRun(owner: string, repo: string, sha: string, withinHours: number = 6): Promise<CiRun | undefined> {
    const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000);
    const results = await db.select().from(ciRuns)
      .where(and(
        eq(ciRuns.repoOwner, owner),
        eq(ciRuns.repoName, repo),
        eq(ciRuns.commitSha, sha),
        sql`${ciRuns.createdAt} > ${cutoff}`,
      ))
      .orderBy(desc(ciRuns.createdAt))
      .limit(1);
    return results[0];
  }

  async createCiJob(runId: string): Promise<CiJob> {
    const [job] = await db.insert(ciJobs).values({ runId, status: "READY" }).returning();
    return job;
  }

  async leaseNextJob(): Promise<{ job: CiJob; run: CiRun } | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const now = new Date();
      const { rows } = await client.query(
        `SELECT * FROM ci_jobs
         WHERE status = 'READY' OR (status = 'LEASED' AND leased_until < $1)
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [now]
      );
      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      const row = rows[0];
      if (row.attempts >= 3) {
        await client.query(
          `UPDATE ci_jobs SET status = 'DEAD', last_error = 'max_attempts_exceeded' WHERE id = $1`,
          [row.id]
        );
        await client.query(
          `UPDATE ci_runs SET status = 'FAILED', finished_at = $1, error = 'max_attempts_exceeded' WHERE id = $2`,
          [now, row.run_id]
        );
        await client.query("COMMIT");
        return null;
      }
      const leaseUntil = new Date(Date.now() + 5 * 60 * 1000);
      await client.query(
        `UPDATE ci_jobs SET status = 'LEASED', attempts = attempts + 1, leased_until = $1 WHERE id = $2`,
        [leaseUntil, row.id]
      );
      await client.query(
        `UPDATE ci_runs SET status = 'RUNNING', started_at = COALESCE(started_at, $1) WHERE id = $2`,
        [now, row.run_id]
      );
      await client.query("COMMIT");

      const job = await this.getCiJobById(row.id);
      const run = await this.getCiRun(row.run_id);
      if (!job || !run) return null;
      return { job, run };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async getCiJobById(id: string): Promise<CiJob | undefined> {
    const [job] = await db.select().from(ciJobs).where(eq(ciJobs.id, id));
    return job;
  }

  async completeJob(jobId: string, status: "DONE" | "DEAD", error?: string): Promise<void> {
    await db.update(ciJobs).set({ status, lastError: error || null }).where(eq(ciJobs.id, jobId));
  }

  async getCiJobCounts(): Promise<Record<string, number>> {
    const result = await db.select({
      status: ciJobs.status,
      count: sql<number>`count(*)::int`,
    }).from(ciJobs).groupBy(ciJobs.status);
    const counts: Record<string, number> = {};
    for (const r of result) {
      counts[r.status] = r.count;
    }
    return counts;
  }

  async getLastCompletedRun(): Promise<CiRun | undefined> {
    const results = await db.select().from(ciRuns)
      .where(or(eq(ciRuns.status, "SUCCEEDED"), eq(ciRuns.status, "FAILED")))
      .orderBy(desc(ciRuns.finishedAt))
      .limit(1);
    return results[0];
  }

  async createCertificate(insertCertificate: InsertCertificate): Promise<Certificate> {
    const [certificate] = await db.insert(certificates).values(insertCertificate).returning();
    return certificate;
  }

  async getCertificate(id: string): Promise<Certificate | undefined> {
    const [certificate] = await db.select().from(certificates).where(eq(certificates.id, id));
    return certificate;
  }

  async getCertificatesByAnalysisId(analysisId: number): Promise<Certificate[]> {
    return await db.select().from(certificates)
      .where(eq(certificates.analysisId, analysisId))
      .orderBy(desc(certificates.issuedAt));
  }

  async getCertificatesByTenantId(tenantId: string, limit: number = 50): Promise<Certificate[]> {
    return await db.select().from(certificates)
      .where(eq(certificates.tenantId, tenantId))
      .orderBy(desc(certificates.issuedAt))
      .limit(limit);
  }

  async insertRun(row: typeof runs.$inferInsert): Promise<RunRow> {
    const [created] = await db.insert(runs).values(row).returning();
    return created;
  }

  async listRunsForProject(projectId: number, limit: number = 100): Promise<RunRow[]> {
    return await db
      .select()
      .from(runs)
      .where(eq(runs.projectId, projectId))
      .orderBy(desc(runs.createdAt))
      .limit(limit);
  }

  async getProjectRun(projectId: number, runId: number): Promise<RunRow | undefined> {
    const [row] = await db
      .select()
      .from(runs)
      .where(and(eq(runs.projectId, projectId), eq(runs.id, runId)))
      .limit(1);
    return row;
  }

  async getAnalysisById(id: number): Promise<Analysis | undefined> {
    const [row] = await db.select().from(analyses).where(eq(analyses.id, id)).limit(1);
    return row;
  }
}

export const storage = new DatabaseStorage();
