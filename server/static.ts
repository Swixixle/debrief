import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { spaFallbackLimiter } from "./middleware/rateLimiter";

/** Vite writes the client bundle to `<repo>/dist/public` (see client/vite.config.ts). */
function resolveDistPublic(): string {
  const fromEnv = process.env.DEBRIEF_STATIC_ROOT?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  // Production runs `node dist/index.cjs`; `__dirname` is `dist/`, so `public` is `dist/public`.
  // Prefer that over cwd-relative paths: PaaS/Docker may set `process.cwd()` to something other than `/app`.
  const fromBundle = path.resolve(__dirname, "public");
  const fromCwd = path.resolve(process.cwd(), "dist", "public");
  for (const candidate of [fromBundle, fromCwd]) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return fromBundle;
}

export function serveStatic(app: Express) {
  const distPath = resolveDistPublic();
  if (!fs.existsSync(path.join(distPath, "index.html"))) {
    throw new Error(
      `Could not find the Vite build output (index.html) in ${distPath}. ` +
        `Build the client first (npm run build). process.cwd()=${process.cwd()} __dirname=${__dirname}`,
    );
  }

  app.use(
    express.static(distPath, {
      maxAge: "1h",
    }),
  );

  // SPA fallback: only after static has tried (and called next() if missing).
  // Avoid Express 5 `/{*path}` routing quirks that can intercept asset requests incorrectly.
  app.use(spaFallbackLimiter, (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}
