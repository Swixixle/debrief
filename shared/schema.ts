import { pgTable, text, serial, integer, timestamp, jsonb, index, uuid, real } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").unique(),
  email: text("email"),
  stripeCustomerId: text("stripe_customer_id"),
  /** 999999 = unlimited while `DEBRIEF_BILLING_ACTIVE` is off; live pricing uses lower defaults for new users. */
  creditsRemaining: integer("credits_remaining").notNull().default(999_999),
  tier: text("tier").notNull().default("free"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("users_clerk_idx").on(table.clerkUserId),
]);

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
}, (table) => [
  index("api_keys_user_idx").on(table.userId, table.createdAt),
]);

export const usersRelations = relations(users, ({ many }) => ({
  apiKeys: many(apiKeys),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));

export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  amount: integer("amount").notNull(),
  type: text("type").notNull(),
  runId: integer("run_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("credit_tx_user_idx").on(table.userId, table.createdAt),
]);

/** One row per analyzer execution (run history / diffs). */
export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  userId: integer("user_id"),
  createdAt: timestamp("created_at").defaultNow(),
  mode: text("mode").notNull(),
  inputType: text("input_type").notNull(),
  dciScore: real("dci_score"),
  claimCount: integer("claim_count"),
  verifiedCount: integer("verified_count"),
  openEndpointCount: integer("open_endpoint_count"),
  criticalIssueCount: integer("critical_issue_count"),
  dependencyCount: integer("dependency_count"),
  flaggedDependencyCount: integer("flagged_dependency_count"),
  runDir: text("run_dir"),
  receiptHash: text("receipt_hash"),
  modelUsed: text("model_used"),
  /** Flexible per-run attrs: branch, commit_hash, environment, flags_used, input_type_detail, tauri_version, … */
  runMetadata: jsonb("run_metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  /** Latest analysis row produced by this run (for history / report fetch). */
  analysisId: integer("analysis_id"),
}, (table) => [
  index("runs_project_idx").on(table.projectId, table.createdAt),
]);

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  name: text("name").notNull(),
  mode: text("mode").notNull().default("github"),
  /** pro | learner — which report style to generate when analyzing */
  reportAudience: text("report_audience").notNull().default("pro"),
  /** Optional Clerk / app user */
  userId: integer("user_id"),
  lastRunAt: timestamp("last_run_at"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  dossier: text("dossier"),
  claims: jsonb("claims"),
  howto: jsonb("howto"),
  operate: jsonb("operate"),
  coverage: jsonb("coverage"),
  unknowns: jsonb("unknowns"),
  /** PTA dependency_graph.json (lockfile summary + OSV flags) */
  dependencyGraph: jsonb("dependency_graph"),
  /** PTA api_surface.json (routes, webhooks, WS — Version A) */
  apiSurface: jsonb("api_surface"),
  /** LEARNER_REPORT.md body when analysis ran with report_audience=learner */
  learnerReport: text("learner_report"),
  /** Ingest discriminator: github, audio, zip, url, text, notion, etc. */
  inputType: text("input_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ciRuns = pgTable("ci_runs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  repoOwner: text("repo_owner").notNull(),
  repoName: text("repo_name").notNull(),
  ref: text("ref").notNull(),
  commitSha: text("commit_sha").notNull(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull().default("QUEUED"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  error: text("error"),
  errorCode: text("error_code"),
  outDir: text("out_dir"),
  summaryJson: jsonb("summary_json"),
}, (table) => [
  index("ci_runs_repo_idx").on(table.repoOwner, table.repoName, table.createdAt),
  index("ci_runs_sha_idx").on(table.commitSha),
  index("ci_runs_status_idx").on(table.status, table.createdAt),
]);

export const ciJobs = pgTable("ci_jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: uuid("run_id").notNull(),
  status: text("status").notNull().default("READY"),
  attempts: integer("attempts").notNull().default(0),
  leasedUntil: timestamp("leased_until"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("ci_jobs_status_idx").on(table.status, table.createdAt),
  index("ci_jobs_lease_idx").on(table.leasedUntil),
]);

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true, status: true, mode: true });
export const insertAnalysisSchema = createInsertSchema(analyses).omit({ id: true, createdAt: true });

export const webhookDeliveries = pgTable("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  repoOwner: text("repo_owner"),
  repoName: text("repo_name"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
}, (table) => [
  index("webhook_deliveries_received_idx").on(table.receivedAt),
]);

// Evidence Bundle Certificates table for Phase 1
export const certificates = pgTable("certificates", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  analysisId: integer("analysis_id").notNull(),
  tenantId: text("tenant_id").notNull(), // For multi-tenancy support
  certificateData: jsonb("certificate_data").notNull(), // Full evidence bundle JSON
  signature: text("signature").notNull(), // Cryptographic signature
  publicKey: text("public_key").notNull(), // PEM-encoded public key for verification
  noteHash: text("note_hash").notNull(), // Hash of the analysis content
  hashAlgorithm: text("hash_algorithm").notNull().default("sha256"),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("certificates_analysis_idx").on(table.analysisId),
  index("certificates_tenant_idx").on(table.tenantId, table.issuedAt),
]);

export const insertCiRunSchema = createInsertSchema(ciRuns).omit({ id: true, createdAt: true, startedAt: true, finishedAt: true, error: true, outDir: true, summaryJson: true });
export const insertCiJobSchema = createInsertSchema(ciJobs).omit({ id: true, createdAt: true, attempts: true, leasedUntil: true, lastError: true });
export const insertCertificateSchema = createInsertSchema(certificates).omit({ id: true, createdAt: true, issuedAt: true });

export type User = typeof users.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Analysis = typeof analyses.$inferSelect;
export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type CiRun = typeof ciRuns.$inferSelect;
export type InsertCiRun = z.infer<typeof insertCiRunSchema>;
export type CiJob = typeof ciJobs.$inferSelect;
export type InsertCiJob = z.infer<typeof insertCiJobSchema>;
export type Certificate = typeof certificates.$inferSelect;
export type InsertCertificate = z.infer<typeof insertCertificateSchema>;
