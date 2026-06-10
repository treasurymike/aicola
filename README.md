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
| Claude model | `claude-haiku-4-5` (default, fast) or `claude-opus-4-8` (thorough, user-selectable) | — |
| Frontend framework | Next.js (App Router) | 15.5.x |
| UI library | React | 19 |
| Frontend language | TypeScript | 5 |
| Runtime (frontend) | Node.js | 18+ (tested on 24.16.0) |

- `POST /api/review` (multipart): `front` + `back` image files,
  `commodity` (`wine` | `distilled spirits` | `malt beverage`),
  `imported` (boolean), `model` (`haiku` default | `opus`). The Claude API
  key is resolved per request: the caller's `X-Anthropic-Api-Key` header if
  provided, otherwise the server's `ANTHROPIC_API_KEY` environment variable.
  Keys are never stored.
- **Batch processing:** the UI supports reviewing multiple labels at once
  ("+ Add another label"); each front/back pair is sent as its own parallel
  request to the stateless endpoint and results render as they complete.
- **Application-data cross-check (TTB F 5100.31):** optional per-label form
  fields — `applicantNameAddress`, `brandName`, `classType`, `netContents`,
  `alcoholContent` — mirror what an applicant declares on the COLA
  application. When provided, the review also verifies form-to-label
  consistency (the second half of a real TTB examiner's job) and returns a
  MATCH/MISMATCH finding per declared field. Exact-match fields (brand name,
  net contents) are additionally verified with a deterministic normalized
  text comparison, like the health-warning regex.
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
3. Upload the front and back label images (JPEG/PNG/GIF/WebP, max 20 MB
   each). Click **+ Add another label** to review multiple products in one
   batch — all labels are processed in parallel.
4. Optionally expand **Application data (TTB F 5100.31)** inside any label
   box and enter the values declared on the COLA application (applicant
   name/address, brand name, class/type, net contents, alcohol content) —
   the results will then include a form-to-label consistency table.
5. Pick the commodity (wine / distilled spirits / malt beverage) and tick
   "Imported product" **per label** — batches can mix commodities. New labels
   inherit the previous label's settings, so homogeneous batches need no
   extra clicks.
6. Under **Advanced settings** (optional): choose the vision model — Claude
   Haiku, the default (~5–15 s per label), or Claude Opus for maximum
   thoroughness (~30–60 s per label) — and/or supply your own API key.
7. Click **Review labels**. Results show one PASS/WARN/FAIL row per
   requirement plus an overall summary, per label — and a MATCH/MISMATCH
   consistency table when application data was provided.

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

## Approach & Assumptions

**Approach.** The core design treats label review as a vision + structured
extraction problem: both label images go to the Claude API in a single
request with a JSON schema that forces a verdict for every requirement (no
parsing, no skipped items). Legally exact-wording rules are then verified
deterministically in code — the Government Health Warning transcription is
checked against the verbatim 27 CFR 16.21 text with a regex — so compliance
with prescribed text never rests on model judgment alone.

**Speed.** Stakeholder feedback prioritized ~5-second turnaround, so the app
uses `claude-haiku-4-5` (Anthropic's fastest vision model) with extended
thinking disabled, and the browser downscales photos to 1600 px on the long
edge before upload (label text remains fully readable; uploads stay under
the API's 5 MB image limit). Typical end-to-end time is ~5–15 seconds. The
model is user-selectable under **Advanced settings**: `claude-opus-4-8`
with adaptive thinking (~30–60 s per label) gives maximum thoroughness when
speed matters less.

**Assumptions:**

- Batch reviews fan out as parallel requests from the browser to the
  stateless endpoint — simple and fast for interactive batch sizes (tens of
  labels). Very large batches (hundreds+) would move the fan-out server-side
  with a job queue.
- Type-size and contrast rules (e.g., minimum 1–2 mm lettering) need physical
  scale that photographs don't carry — treated as manual-review items, noted
  in the UI disclaimer.
- Commodity-specific rule depth (age statements for spirits, vintage and
  appellation rules for wine, ABV optionality for malt beverages) is
  delegated to the model via the prompt; productionizing would move these
  into code as a per-commodity rules table.
- Wines under 7% ABV and non-malt-beverage products (e.g., sugar-based hard
  seltzers) fall under FDA rather than TTB labeling rules; the app assumes
  in-scope FAA Act products.
- Labels photographed at angles or in poor lighting are handled by the
  model's vision robustness plus an explicit instruction to report illegible
  text with lowered confidence rather than guess.

### Azure deployment path

The current demo runs on Railway for convenience. For TTB's stated
environment — Azure-based infrastructure with firewall restrictions on
outbound traffic to external APIs — the same code deploys with two changes:

1. Host the backend on **Azure App Service or Container Apps** (the Spring
   Boot jar is platform-agnostic; `server.port=${PORT:8080}` already handles
   platform port injection) and the frontend on **Azure Static Web Apps**.
2. Call Claude through **Microsoft Foundry**, which serves Anthropic models
   natively inside Azure — the backend then talks to an Azure endpoint
   instead of `api.anthropic.com`, so no firewall exception for external
   APIs is required. The Anthropic SDK supports Foundry as a first-class
   backend; this is a client-construction change in `ColaLabelChecker`, not
   a rewrite.

## Known limitations

- **Type-size and contrast rules can't be verified from a photo alone** (they
  need physical scale). Treat those as manual-review items.
- Commodity-specific logic (e.g., alcohol content is optional federally for
  malt beverages) is passed to the model via the prompt; for production use,
  move those rules into code.
