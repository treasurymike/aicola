# aicola — TTB COLA Label Pre-Screener

> Solution by Mike Chen <mike2025@rocketship.com> created using Claude Fable 5 AI
> for the U.S. Department of Treasury as part of the candidate interview process.

**🚀 Live demo (production):** https://aicola-mike-chen.up.railway.app/ —
upload front and back label images to try it. The Claude API key field is
optional; leave it blank to use the server's configured key.

Checks a pair of alcohol beverage label images (front + back) against the 8
mandatory TTB COLA label requirements (27 CFR Parts 4, 5, 7, and 16) using the
Claude API with vision and structured outputs.

> **This is a pre-screen only.** Only TTB (via [COLAs Online](https://www.ttb.gov/alfd/certificate-of-label-aproval-cola))
> can approve a label.

## Architecture

```
aicola/
├── backend/    Spring Boot REST API (Java 21, Maven)
└── frontend/   Next.js upload UI (TypeScript, App Router)
```

## Tech stack

| Component | Technology | Version |
|---|---|---|
| Backend framework | Spring Boot | 3.5.7 |
| Backend language | Java | 21 (tested on JDK 26) |
| Build tool | Apache Maven | 3.8+ (tested on 4.0.0-rc-5) |
| Claude API SDK | `com.anthropic:anthropic-java` | 2.34.0 |
| Claude model | `claude-opus-4-8` | — |
| Frontend framework | Next.js (App Router) | 15.5.x |
| UI library | React | 19 |
| Frontend language | TypeScript | 5 |
| Runtime (frontend) | Node.js | 18+ (tested on 24.16.0) |

- `POST /api/review` (multipart): `front` + `back` image files,
  `commodity` (`wine` | `distilled spirits` | `malt beverage`),
  `imported` (boolean). The Claude API key is resolved per request: the
  caller's `X-Anthropic-Api-Key` header if provided, otherwise the server's
  `ANTHROPIC_API_KEY` environment variable. Keys are never stored.
- The backend sends both images to Claude in one request with a structured
  output schema (one verdict per requirement), then applies a deterministic
  regex check that the Government Health Warning matches the exact wording
  prescribed by 27 CFR 16.21.

## The 8 requirements checked

1. Brand name
2. Class and type designation (standards of identity)
3. Alcohol content
4. Name and address (bottler/producer/importer statement)
5. Net contents
6. Country of origin (imports only)
7. Government Health Warning statement (verified verbatim via regex post-check)
8. Commodity-specific disclosures (sulfites, FD&C Yellow No. 5, etc.)

## Running locally

Prerequisites: **JDK 21+**, **Maven 3.8+**, **Node.js 18+**, and a
**Claude API key** (created at https://platform.claude.com — either set as
`ANTHROPIC_API_KEY` on the backend, or entered in the UI at request time).

Run the backend and frontend in **two separate terminals**.

### Terminal 1 — backend (http://localhost:8080)

```powershell
cd aicola\backend
mvn spring-boot:run
```

Wait for the `Started AiColaApp` log line. To stop, press `Ctrl+C`.

### Terminal 2 — frontend (http://localhost:3000)

```powershell
cd aicola\frontend
npm install      # first run only
npm run dev
```

### Use the app

1. Open http://localhost:3000 in a browser.
2. Optionally paste your Claude API key (`sk-ant-...`) — it is sent
   per-request in the `X-Anthropic-Api-Key` header and never stored. If left
   blank, the backend uses its `ANTHROPIC_API_KEY` environment variable.
3. Upload the front and back label images (JPEG/PNG/GIF/WebP, max 20 MB each).
4. Pick the commodity (wine / distilled spirits / malt beverage) and tick
   "Imported product" if applicable.
5. Click **Review labels**. Reviews take ~30–60 seconds; results show one
   PASS/WARN/FAIL row per requirement plus an overall summary.

### Production-style run (optional)

```powershell
# Backend: build a runnable jar, then start it
cd aicola\backend
mvn package
java -jar target\aicola-backend-0.1.0.jar

# Frontend: optimized build + server
cd aicola\frontend
npm run build
npm start
```

If the backend runs anywhere other than `http://localhost:8080`, set
`NEXT_PUBLIC_API_BASE_URL` to its URL before building/starting the frontend.

## Configuration

| Setting | Where | Default |
|---|---|---|
| Server default Claude API key | `ANTHROPIC_API_KEY` env var on the backend | none — callers must then supply their own key |
| Backend port | `backend/src/main/resources/application.properties` | 8080 (or the `PORT` env var) |
| Max upload size | same file | 20 MB per file |
| Backend URL used by frontend | `NEXT_PUBLIC_API_BASE_URL` env var | `http://localhost:8080` |
| CORS allowed origins | `backend/.../CorsConfig.java` | `*` (dev only — restrict before deploying) |

## Deploying to Railway

The production instance runs on [Railway](https://railway.app) as **two
services from this single repo**. Railway's builder (Railpack) detects the
project type from the *root directory of each service*, so the monorepo
layout requires setting the root directory per service — without it the
build fails with a "could not determine how to build" error.

1. **Create the backend service**
   - New service → Deploy from this GitHub repo.
   - Settings → Source → **Root Directory:** `/backend`. Railpack then
     detects `pom.xml` and builds with JDK 21 + Maven automatically.
   - Variables → add `ANTHROPIC_API_KEY` = your Claude API key (this is the
     server default used when callers don't supply their own).
   - Settings → Networking → **Generate Domain**; note the URL.
   - Port binding works out of the box: `application.properties` uses
     `server.port=${PORT:8080}`, and Railway injects `PORT`.

2. **Create the frontend service**
   - Second service from the same repo.
   - Settings → Source → **Root Directory:** `/frontend`. Railpack detects
     `package.json` and runs `npm install` + `next build` + `next start`.
   - Variables → add `NEXT_PUBLIC_API_BASE_URL` = the backend service's
     public URL from step 1 (e.g. `https://aicola-backend.up.railway.app`).
     **Set this before the first build** — `NEXT_PUBLIC_*` values are baked
     in at build time, so changing it later requires a redeploy.
   - Settings → Networking → Generate Domain — this is the user-facing URL.

3. **Redeploys** are automatic: every `git push` to `main` rebuilds both
   services.

## Deployment notes

- Build the backend into a runnable jar with `mvn package`
  (`backend/target/aicola-backend-0.1.0.jar`), deployable to any Java host or
  a container.
- Build the frontend with `npm run build` and host on Vercel/Netlify or
  `npm start` on a node host; set `NEXT_PUBLIC_API_BASE_URL` to the deployed
  backend URL.
- **Before production:** restrict `CorsConfig` to the frontend's origin, and
  serve both over HTTPS — the user's API key travels in a request header.

## Known limitations

- **Type-size and contrast rules can't be verified from a photo alone** (they
  need physical scale). Treat those as manual-review items.
- Commodity-specific logic (e.g., alcohol content is optional federally for
  malt beverages) is passed to the model via the prompt; for production use,
  move those rules into code.
