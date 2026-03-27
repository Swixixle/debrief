# Market context

Strategic framing for Program Totality Analyzer / Debrief: who it serves, the wedge, and adjacent opportunities.

---

## Future capability: API surface mapping / webhook discovery

Concept: point Debrief at any third-party software (SaaS platform, enterprise tool, work system) and have it read the API docs, OpenAPI/Swagger specs, or webhook documentation and produce the same plain-language output format — what this system can do, what it exposes, how to make it talk to other things — without the user ever needing to open the product or read technical docs.

Use case: someone is handed Salesforce, an EHR, or any enterprise platform at work and needs to understand its integration surface without being an engineer.

Input formats this would require (not currently supported):

- OpenAPI / Swagger specs
- Postman collections
- Webhook payload schemas
- Plain API documentation pages (URL input)

This is a different parser path from source code analysis. Log as a future capability. Do not build now — current focus is code repos.

---

**Legal note: API surface mapping + healthcare vertical**

The API surface mapping capability (future) carries specific legal risk in healthcare.
Epic's integration program requires partner agreements just to access certain API
documentation levels. Any work in the EHR/Epic space should be reviewed by a lawyer
before building or selling. HIPAA business associate agreement exposure is possible
if Debrief is ever processing actual patient data schemas rather than public specs.

For non-healthcare enterprise SaaS (Salesforce, Workday, ServiceNow): publicly published
OpenAPI specs are generally safe to analyze. Add a ToS clause clarifying Debrief does
not store or redistribute third-party specs — it analyzes and discards.

Do not enter the Epic vertical without legal counsel. Everything else: proceed.

---

**Next build: API Surface Mapping — Version B (third-party specs)**

After Version A (owned codebase API surface extraction) ships,
Version B is the next milestone:

Input: a URL pointing to a published OpenAPI/Swagger spec,
a Postman collection, or a plain API docs page.

Output: same API_SURFACE.md + api_surface.json format as Version A,
but sourced from the spec rather than source code.

Use cases:

- "We're acquiring a company that uses Salesforce heavily — what is
  their integration surface?"
- "Our hospital just licensed Epic — what data moves where?"
- "I need to know what this SaaS tool can do before I connect it
  to our systems."

Parser targets in priority order:

1. OpenAPI 3.x / Swagger 2.x (JSON or YAML)
2. Postman Collection v2
3. Plain docs URL (LLM-assisted extraction, lower confidence)

Legal note: see Epic/healthcare warning in MARKET_CONTEXT.md before
entering that vertical. Public specs are generally safe. EHR requires
legal review first.

Do not build Version B until Version A is shipping cleanly.

---

## AI-native non-engineer coders

Builders who ship with AI assistance but do not identify as software engineers — hobbyists, founders, creators, and operators wiring tools together.

---

**Learner Mode — the specific product for this segment**

One toggle. Same analyzer. Completely different output language.

The Stack Audit section is the second hook after "What the AI
Got Wrong." It tells people exactly what they're spending,
what they're wasting, and what to switch to — personalized
to their actual codebase, with live pricing.

Nobody else does this. Generic "best AI coding tools" lists
are everywhere. A list generated from reading YOUR code and
YOUR configs, with current prices and direct links, is new.

This spreads. People screenshot Section 5 and post it.

**Distribution:** X/Twitter, Discord, Reddit r/ChatGPTCoding,
Replit community, freeCodeCamp forums.

**Funnel:** free learner tier → word of mouth → enterprise buyer
discovers Debrief through their team → M&A Pro engagement.

---

**Distribution strategy — production**

**Primary:** Tauri desktop app + Mac App Store path. Someone sees a screenshot, installs in under a minute. Clerk + free credits land with Stripe checkout for top-ups.

**Secondary:** GitHub Action template (`.github/workflows/debrief-sample.yml`) — Learner feedback on every push once the public action ships.

**Tertiary:** VS Code extension (stub under `extensions/vscode/`) — right-click analyze from the editor.

**Word-of-mouth surfaces:** Stack Audit screenshots, “What the AI Got Wrong,” and DCI / progress charts (“67% → 89%”) from the upcoming run-history UI.

**Intent:** The product should feel fast and honest enough that someone shows another person right after the first run. That *is* the distribution plan.
