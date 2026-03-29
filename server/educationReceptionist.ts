import OpenAI from "openai";
import { z } from "zod";

const bodySchema = z.object({
  nodeId: z.string(),
  mode: z.enum(["explain", "other-ways", "suggestions", "keep-it"]),
  nodeContext: z.object({
    label: z.string(),
    shape: z.string(),
    layer: z.string(),
    state: z.string(),
    criticality: z.string(),
    role: z.string(),
    technology: z.string(),
    anomalies: z.array(z.string()),
  }),
  runId: z.string(),
});

export type ReceptionistBody = z.infer<typeof bodySchema>;

const SYSTEM_PROMPT = `You are a calm, patient guide explaining software to someone who just built 
their first app with AI assistance. They are smart but not technical. 
They want to understand what they have, not be lectured at.

Rules without exception:
1. Write at a 9th-10th grade reading level
2. Never use jargon without immediately defining it in plain English in the same sentence
3. Be specific to this exact component — never generic
4. Answer "so what?" — why should this person care
5. Maximum 3 sentences for Explain mode
6. Never use bullet points in Explain mode — write in sentences
7. Never suggest something is wrong if it isn't
8. In Keep It mode — be direct and mean it. Do not hedge.
9. In Other Ways mode — never say "you should switch to X". Say "some systems do this differently"
10. Start from the assumption that the current choice is reasonable. Offer alternatives as options, not corrections.
11. Never use abbreviations or acronyms without explaining them inline the first time they appear.
Write the full term first, then the abbreviation in parentheses if you need to reuse it.
Examples:
- NOT: "PTA scores your DCI before sealing the receipt"
- YES: "The analyzer scores your Dependency Complexity Index (DCI) — a measure of how tangled your dependencies are — before sealing the receipt"
- NOT: "Ed25519 signing via JCS canonical JSON"  
- YES: "The receipt is signed using Ed25519 — an algorithm that produces a short, verifiable fingerprint — so anyone with your public key can confirm the file hasn't been altered"
- NOT: "CVE flagged in your SBOM"
- YES: "A known vulnerability (CVE, or Common Vulnerability and Exposure) was detected in one of your dependencies"
Never assume the reader knows what PTA, DCI, JCS, HMAC, BullMQ, Drizzle, or any other technical term means.`;

export type AlternativeStrategies = {
  simpler: string;
  more_scalable: string;
  why_keep_it: string;
};

type CachedEntry = { text: string; strategies?: AlternativeStrategies };

const CACHE = new Map<string, CachedEntry>();

function cacheKey(runId: string, nodeId: string, mode: string): string {
  return `${runId}|${nodeId}|${mode}`;
}

function buildUserPrompt(body: ReceptionistBody): string {
  const c = body.nodeContext;
  if (body.mode === "explain") {
    return `Component: ${c.label}
Type: ${c.shape} in the ${c.layer} layer
Current state: ${c.state}
What it does: ${c.role}

Explain what this is and why it exists. 3 sentences maximum. 
Specific to this app, not generic. Answer "so what?" at the end.`;
  }
  if (body.mode === "other-ways") {
    return `Component: ${c.label}
Technology: ${c.technology}

Describe 2-3 different ways this could be handled instead. 
What are the tradeoffs? Frame these as valid options, not corrections.
The current approach is reasonable — these are just other paths that exist.`;
  }
  if (body.mode === "suggestions") {
    const an = c.anomalies.length ? c.anomalies.join(", ") : "none";
    return `Component: ${c.label}
State: ${c.state}
Anomalies: ${an}

If there is something genuinely worth suggesting, say it in 2 sentences.
If nothing is wrong, respond with exactly: "Nothing to change here. This is working as it should."
Do not invent suggestions. Only flag real issues from the anomalies list.`;
  }
  return `Component: ${c.label}
Criticality: ${c.criticality}
State: ${c.state}

Tell the user directly whether this is safe to leave alone.
If it is essential and working, give them explicit permission to stop worrying about it.
Be direct. Do not hedge. Maximum 2 sentences.`;
}

const QC_PROMPT = `Score this explanation (yes/no for each):
1. Does it avoid undefined jargon?
2. Is it specific, not generic?
3. Is it 9th-10th grade reading level?
4. Does it answer "so what?"

If any answer is no, rewrite to fix it. Return only the final explanation.`;

const SUGGESTIONS_CLEAR_EXACT = "Nothing to change here. This is working as it should.";

const KEEP_IT_HEDGE_PROMPT = `Does this response give the user clear permission to stop worrying about this component?
Does it use hedging language like "seems", "appears", "might be", "could be", "generally"?

If hedging is present, rewrite it to be direct. Replace "seems to be working" with "is working".
Replace "you might want to leave this" with "leave this alone".
Return only the rewritten response.`;

async function keepItHedgePass(client: OpenAI, draft: string): Promise<string> {
  const model = process.env.DEBRIEF_ANALYZER_MODEL || "gpt-4.1-mini";
  const res = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `You tighten short reassurance text for software learners. ${KEEP_IT_HEDGE_PROMPT}`,
      },
      { role: "user", content: draft },
    ],
    max_completion_tokens: 300,
  });
  return (res.choices[0]?.message?.content ?? "").trim() || draft;
}

function createClient(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
  });
}

async function chatOnce(client: OpenAI, user: string, maxTokens: number): Promise<string> {
  const model = process.env.DEBRIEF_ANALYZER_MODEL || "gpt-4.1-mini";
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    max_completion_tokens: maxTokens,
  });
  return (res.choices[0]?.message?.content ?? "").trim();
}

async function qualityPass(client: OpenAI, draft: string, mode: ReceptionistBody["mode"]): Promise<string> {
  const model = process.env.DEBRIEF_ANALYZER_MODEL || "gpt-4.1-mini";
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You rewrite educational text for clarity. " + QC_PROMPT },
      {
        role: "user",
        content: `Mode was ${mode}. Draft:\n\n${draft}\n\nReturn only the final explanation text.`,
      },
    ],
    max_completion_tokens: 500,
  });
  return (res.choices[0]?.message?.content ?? "").trim() || draft;
}

export async function extractAlternativeStrategies(
  client: OpenAI | null,
  otherWaysText: string,
): Promise<AlternativeStrategies> {
  const fallback: AlternativeStrategies = {
    simpler: otherWaysText.slice(0, 240),
    more_scalable: "Larger teams sometimes centralize this in a dedicated service.",
    why_keep_it: "What you have is a solid default for Debrief-sized projects.",
  };
  if (!client || !otherWaysText.trim()) return fallback;
  try {
    const model = process.env.DEBRIEF_ANALYZER_MODEL || "gpt-4.1-mini";
    const res = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            'Return only a JSON object with keys simpler, more_scalable, why_keep_it (strings). Each one sentence. Tone: current choice is reasonable.',
        },
        {
          role: "user",
          content: `Split into three perspectives:\n\n${otherWaysText}`,
        },
      ],
      max_completion_tokens: 400,
    });
    const raw = res.choices[0]?.message?.content?.trim();
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return {
      simpler: String(parsed.simpler || fallback.simpler),
      more_scalable: String(parsed.more_scalable || fallback.more_scalable),
      why_keep_it: String(parsed.why_keep_it || fallback.why_keep_it),
    };
  } catch {
    return fallback;
  }
}

export async function runReceptionist(rawBody: unknown): Promise<{
  ok: boolean;
  error?: string;
  text?: string;
  strategies?: AlternativeStrategies;
  cached?: boolean;
}> {
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return { ok: false, error: "Invalid body" };
  }
  const body = parsed.data;
  const key = cacheKey(body.runId, body.nodeId, body.mode);
  const hit = CACHE.get(key);
  if (hit) {
    return {
      ok: true,
      text: hit.text,
      strategies: hit.strategies,
      cached: true,
    };
  }

  if (body.mode === "suggestions" && (!body.nodeContext.anomalies || body.nodeContext.anomalies.length === 0)) {
    CACHE.set(key, { text: SUGGESTIONS_CLEAR_EXACT });
    return {
      ok: true,
      text: SUGGESTIONS_CLEAR_EXACT,
      strategies: undefined,
      cached: false,
    };
  }

  const client = createClient();
  if (!client) {
    return { ok: false, error: "OpenAI API key not configured" };
  }

  const user = buildUserPrompt(body);
  const maxTok = body.mode === "explain" ? 220 : body.mode === "keep-it" ? 200 : 400;
  let draft = await chatOnce(client, user, maxTok);
  draft = await qualityPass(client, draft, body.mode);
  if (body.mode === "keep-it") {
    draft = await keepItHedgePass(client, draft);
  }

  let strategies: AlternativeStrategies | undefined;
  if (body.mode === "other-ways") {
    strategies = await extractAlternativeStrategies(client, draft);
  }

  CACHE.set(key, { text: draft, strategies });
  return { ok: true, text: draft, strategies, cached: false };
}

/** Test hook: clear in-memory cache */
export function clearReceptionistCache(): void {
  CACHE.clear();
}

/** Test hook: quality-only pass */
export async function runQualityCheckOnly(client: OpenAI, draft: string, mode: ReceptionistBody["mode"]): Promise<string> {
  return qualityPass(client, draft, mode);
}

/** Test hook: keep-it hedge pass only */
export async function runKeepItHedgePassOnly(client: OpenAI, draft: string): Promise<string> {
  return keepItHedgePass(client, draft);
}
