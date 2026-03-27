/**
 * Public Notion share links — best-effort HTML fetch and strip tags.
 * Private pages require the official API + token (not handled here).
 */
export async function fetchNotionPublicAsPlainText(notionUrl: string): Promise<string> {
  const res = await fetch(notionUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "DebriefNotionFetch/1.0",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`Notion fetch failed: HTTP ${res.status}`);
  }
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48_000);
}
