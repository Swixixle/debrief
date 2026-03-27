# Debrief demo script (10 minutes)

A literal script for a live demo to an M&A advisor or CTO.

---

**Scene:** You are showing Debrief to someone evaluating it for tech due diligence.
They are not engineers. They are paying $50K–$150K per engagement today.

**Step 1 — The problem (90 seconds)**

- Say: *"When you're evaluating a company, what do you actually know about their codebase?"*
- Let them answer. The answer is usually: not much, or we hire a consultant.
- Say: *"This is what $50K buys you today."* Show a blank page.

**Step 2 — The run (60 seconds)**

- Paste the target repo URL. Hit analyze. Show the progress.
- Say: *"This takes about 2 minutes. It's reading every file."*

**Step 3 — The ONEPAGER (2 minutes)**

- Open ONEPAGER.md.
- Say: *"This is what you hand to a CFO. Plain language, no code, under 3 minutes to read. These are the risk flags."*
- Read the risk flags section out loud.

**Step 4 — The DOSSIER (3 minutes)**

- Open DOSSIER.md. Find the same risk theme you just called out on the ONEPAGER (e.g. dependency exposure, TLS, secrets).
- Say: *"Every one of these is cited at a specific file and line number. This isn't a summary. It's a record."*
- Show the VERIFIED / INFERRED / UNKNOWN labels.
- Show the *"What it is NOT"* section.
- Say: *"The unknowns section is the most important part. Most tools hide what they don't know. This one shows you."*

**Step 5 — The receipt (90 seconds)**

- Open receipt.json.
- Say: *"This run record is hashed and timestamped. If anyone tampers with the dossier, the numbers no longer line up. You can drop this in the deal room."*

**Step 6 — The ask**

- *"We charge $5K per analysis. You're paying $50K today for something slower and less verifiable. Want to run it on something live?"*
