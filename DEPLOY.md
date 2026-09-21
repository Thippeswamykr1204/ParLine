# Deploy to Render (free tier)

## 1. Push to GitHub
```bash
cd bar_inventory_project
git init && git add . && git commit -m "ParLine: forecasting + par levels"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
`.env` is git-ignored: never commit it. Confirm with `git status` that `.env` is not listed.

## 2. Create the stack
Render Dashboard > **New +** > **Blueprint** > select the repo. Render reads `render.yaml` and creates
`parline-db` (Postgres), `parline-api` (Docker) and `parline-web` (Next.js). When prompted, fill:

| Variable | Service | Value |
|---|---|---|
| `GROQ_API_KEY` | parline-api | free key from https://console.groq.com/keys |
| `CORS_ORIGINS` | parline-api | leave blank for now |
| `NEXT_PUBLIC_API_BASE_URL` | parline-web | leave blank for now |

## 3. Wire the two URLs (needed once)
Service names must be globally unique; if `parline-api` / `parline-web` are taken, Render appends a suffix. Use the real URLs shown in the dashboard.
1. `parline-api` > Environment > `CORS_ORIGINS` = `https://<web-url>.onrender.com` (no trailing slash) > Save.
2. `parline-web` > Environment > `NEXT_PUBLIC_API_BASE_URL` = `https://<api-url>.onrender.com`, then **Manual Deploy > Clear build cache & deploy**. `NEXT_PUBLIC_*` values are baked in at build time, so a redeploy is required.

## 4. Verify
* `https://<api-url>/api/v1/health` returns OK (first boot migrates and seeds the database, so allow a few minutes).
* `https://<api-url>/docs` shows the API.
* Open the web URL, then ask the chat panel a question.

## Free-tier caveats
* Free web services sleep after ~15 min idle; the next request takes ~30-60 s. Open the API URL first to wake it before a demo.
* The free Postgres instance has a limited lifetime and size on Render; check their current terms. Data is re-seedable from the repo, so recreating the database is safe.
* Disk is ephemeral: files dropped in `data/incoming` and the optional daily scheduler are not persistent on the free plan.