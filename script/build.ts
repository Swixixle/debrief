import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";
import path from "path";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "bullmq",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "extract-zip",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "ioredis",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild({ configFile: path.join(process.cwd(), "client", "vite.config.ts") });

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  const esbuildOpts = {
    platform: "node" as const,
    bundle: true,
    format: "cjs" as const,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    alias: {
      "@shared": path.resolve(process.cwd(), "shared"),
    },
    logLevel: "info" as const,
  };

  await esbuild({
    ...esbuildOpts,
    entryPoints: ["server/index.ts"],
    outfile: "dist/index.cjs",
  });

  console.log("building analyzer worker bundle...");
  await esbuild({
    ...esbuildOpts,
    entryPoints: ["server/analyzer-worker-entry.ts"],
    outfile: "dist/worker.cjs",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
