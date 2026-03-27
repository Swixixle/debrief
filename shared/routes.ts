import { z } from 'zod';
import { insertProjectSchema, projects, analyses } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  projects: {
    list: {
      method: 'GET' as const,
      path: '/api/projects' as const,
      responses: {
        200: z.array(z.custom<typeof projects.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/projects' as const,
      input: insertProjectSchema.extend({
        mode: z.enum(["github", "local", "replit", "git_clone"]).optional().default("github"),
        reportAudience: z.enum(["pro", "learner"]).optional().default("pro"),
      }),
      responses: {
        201: z.custom<typeof projects.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/projects/:id' as const,
      responses: {
        200: z.custom<typeof projects.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    getAnalysis: {
      method: 'GET' as const,
      path: '/api/projects/:id/analysis' as const,
      responses: {
        200: z.custom<typeof analyses.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    analyze: {
      method: 'POST' as const,
      path: '/api/projects/:id/analyze' as const,
      responses: {
        202: z.object({ message: z.string() }),
        404: errorSchemas.notFound,
      },
    },
    analyzeReplit: {
      method: 'POST' as const,
      path: '/api/projects/analyze-replit' as const,
      responses: {
        201: z.custom<typeof projects.$inferSelect>(),
        500: errorSchemas.internal,
      },
    },
    cloneAnalyze: {
      method: 'POST' as const,
      path: '/api/projects/clone-analyze' as const,
      input: z.object({
        gitUrl: z.string().min(1, 'gitUrl is required'),
        name: z.string().optional(),
      }),
      responses: {
        201: z.custom<typeof projects.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
