import express, { type Express } from "express";
import fs from "fs";
import path from "path";

/** Vite writes the client bundle to `<repo>/dist/public` (see client/vite.config.ts). */
function resolveDistPublic(): string {
  const fromEnv = process.env.DEBRIEF_STATIC_ROOT?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  const fromCwd = path.resolve(process.cwd(), "dist", "public");
  const fromBundle = path.resolve(__dirname, "public");
  for (const candidate of [fromCwd, fromBundle]) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return fromCwd;
}

export function serveStatic(app: Express) {
  // TEMP: debug Render static/CSS — remove after paths are confirmed in logs
  const cwdPublic = path.join(process.cwd(), "dist", "public");
  console.log("[static] cwd:", process.cwd());
  console.log("[static] __dirname:", __dirname);
  console.log("[static] resolved dist/public:", cwdPublic);
  console.log("[static] index.html exists:", fs.existsSync(path.join(cwdPublic, "index.html")));

  const distPath = resolveDistPublic();
  console.log("[static] chosen distPath:", distPath);
  console.log(
    "[static] chosen index.html exists:",
    fs.existsSync(path.join(distPath, "index.html")),
  );

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
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}
