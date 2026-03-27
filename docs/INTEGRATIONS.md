# Debrief Integrations

## GitHub Action

Run Debrief on every push. Get a report on every PR.

```yaml
# .github/workflows/debrief.yml
name: Debrief Analysis
on: [push, pull_request]
jobs:
  debrief:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/debrief-action
        with:
          api-key: ${{ secrets.DEBRIEF_API_KEY }}
          mode: learner
```

Generate your API key at **Settings → API Keys** in the web app (requires sign-in).

## REST API

All integrations use the same API (requires queue mode for async jobs: `REDIS_URL` + `DEBRIEF_USE_BULLMQ=1` and a running worker).

```http
POST /api/v1/analyze
Authorization: Bearer dk_...
Content-Type: application/json

{"repoUrl":"https://github.com/org/repo","mode":"learner","model":"gpt-4.1"}
```

→ **202** `{ projectId, jobId, statusUrl, reportUrl }`

```http
GET /api/v1/jobs/:jobId
```

→ `{ status, progress, message, result, error }`

```http
GET /api/v1/projects/:id/report
```

→ `text/markdown` (learner report or dossier)

## VS Code (coming soon)

Right-click any folder → Analyze with Debrief.

## Slack (coming soon)

`/debrief https://github.com/user/repo`

## Discord (coming soon)

`/debrief https://github.com/user/repo`

## Zapier (planned)

- Trigger: new Debrief report available  
- Action: create Debrief analysis  

## Direct inputs supported

- GitHub, GitLab, Bitbucket URLs  
- Replit project URLs  
- Local folder path (desktop app)  
- `.zip` file (drag and drop)  
- Deployed app URL (surface scan)  
- Audio description (voice input)  
- Text / README description  
- Notion page URL  
