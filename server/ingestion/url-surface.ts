import path from "node:path";

import { writeUtf8UnderDir } from "../utils/safeDerivedFileWrite";

const MAX_SURFACE_MD_BYTES = 4 * 1024 * 1024;
const MAX_SURFACE_JSON_BYTES = 4 * 1024 * 1024;

const PROBE_PATHS = [
  "/api",
  "/api/health",
  "/api/docs",
  "/__version__",
  "/swagger.json",
  "/openapi.json",
  "/robots.txt",
  "/sitemap.xml",
];

async function probePath(origin: string, pathname: string): Promise<{ path: string; status: number; snippet: string }> {
  const url = new URL(pathname, origin).href;
  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "DebriefSurfaceBot/1.0 (+https://debrief)" },
    });
    const text = await r.text();
    return {
      path: pathname,
      status: r.status,
      snippet: text.slice(0, 500).replace(/\s+/g, " ").trim(),
    };
  } catch (e) {
    return { path: pathname, status: 0, snippet: `(unknown) ${String((e as Error)?.message || e)}` };
  }
}

/**
 * Deployed-surface snapshot: headers, assets, robots/sitemap, common API paths.
 * Writes surface_scan.md — all claims downstream should stay INFERRED / UNKNOWN.
 */
export async function buildUrlSurfaceWorkspace(targetDir: string, pageUrl: string): Promise<void> {
  const u = new URL(pageUrl);
  const res = await fetch(pageUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "DebriefSurfaceBot/1.0 (+https://debrief)",
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
  });
  const html = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });

  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"'>\s]+)["']/gi)]
    .map((m) => m[1])
    .slice(0, 80);
  const links = [...html.matchAll(/<link[^>]+href=["']([^"'>\s]+)["']/gi)]
    .map((m) => m[1])
    .slice(0, 40);

  const robotsUrl = new URL("/robots.txt", u.origin).href;
  let robots = "";
  try {
    const r = await fetch(robotsUrl, { headers: { "User-Agent": "DebriefSurfaceBot/1.0" } });
    if (r.ok) robots = (await r.text()).slice(0, 12000);
  } catch {
    robots = "(unknown — fetch failed)";
  }

  const sitemapUrl = new URL("/sitemap.xml", u.origin).href;
  let sitemapNote = "";
  try {
    const r = await fetch(sitemapUrl, { headers: { "User-Agent": "DebriefSurfaceBot/1.0" } });
    sitemapNote =
      r.ok
        ? `(INFERRED) sitemap.xml responded HTTP ${r.status}, length ${(await r.text()).length} chars`
        : `(INFERRED) sitemap.xml HTTP ${r.status}`;
  } catch {
    sitemapNote = "(UNKNOWN) sitemap fetch failed";
  }

  const probes = await Promise.all(PROBE_PATHS.map((p) => probePath(u.origin, p)));

  const interestingHeaders = [
    "server",
    "x-powered-by",
    "x-framework",
    "via",
    "cf-ray",
    "x-amz-cf-id",
  ];
  const headerPick: Record<string, string> = {};
  for (const k of interestingHeaders) {
    const found = Object.keys(headers).find((h) => h.toLowerCase() === k);
    if (found) headerPick[found] = headers[found]!;
  }

  const md = [
    "# Deployed surface scan",
    "",
    `**(INFERRED/UNKNOWN)** All sections derived from HTTP responses only — no source repository.`,
    "",
    `- Fetched: ${new Date().toISOString()}`,
    `- URL: ${pageUrl}`,
    `- Root HTTP status: ${res.status}`,
    "",
    "## Response headers (selected)",
    "```json",
    JSON.stringify(headerPick, null, 2),
    "```",
    "",
    "## Bundle hints — script src (first N, INFERRED)",
    ...scripts.map((s) => `- ${s}`),
    "",
    "## Link href (first N, INFERRED)",
    ...links.map((s) => `- ${s}`),
    "",
    "## robots.txt excerpt",
    "```",
    robots.slice(0, 4000),
    "```",
    "",
    "## sitemap",
    sitemapNote,
    "",
    "## Path probes (INFERRED status only)",
    ...probes.map((p) => `- \`${p.path}\` → HTTP ${p.status} — ${p.snippet.slice(0, 120)}`),
    "",
    "See also `surface_snapshot.json` in this folder.",
  ].join("\n");

  await writeUtf8UnderDir(targetDir, "surface_scan.md", md, MAX_SURFACE_MD_BYTES);
  await writeUtf8UnderDir(
    targetDir,
    "surface_snapshot.json",
    JSON.stringify(
      {
        kind: "url_surface_v2",
        url: pageUrl,
        status: res.status,
        headers,
        header_pick: headerPick,
        scripts,
        links,
        robots_excerpt: robots.slice(0, 2000),
        sitemap_note: sitemapNote,
        probes,
      },
      null,
      2,
    ),
    MAX_SURFACE_JSON_BYTES,
  );
}
