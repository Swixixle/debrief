# Debrief GitHub Action

Analyze your codebase on every push. Get a plain-language report as a PR comment.

## Usage

```yaml
- uses: debrief-app/debrief-action@v1
  with:
    api-key: ${{ secrets.DEBRIEF_API_KEY }}
    mode: learner
```

Generate your API key at https://app.debrief.app/settings/keys.

## Build

From this directory:

```bash
npm install
npm run build
```

`ncc` emits a self-contained `dist/index.js`. Commit `dist/` (and `licenses.txt` if present) so runners do not need `npm install`.
