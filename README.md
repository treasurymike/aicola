# aicola — TTB COLA Label Pre-Screener

> Solution by Mike Chen <mike2025@rocketship.com> created using Claude Fable 5 AI
> for the U.S. Department of Treasury as part of the candidate interview process.

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
  `imported` (boolean). The caller's Anthropic API key is passed per-request
  in the `X-Anthropic-Api-Key` header — the server stores no key.
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

Prerequisites: **JDK 21+**, **Maven 3.8+**, **Node.js 18+**, and an
**Anthropic API key** (created at https://platform.claude.com — entered in
the UI at request time, not configured on the server).

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
2. Paste your Anthropic API key (`sk-ant-...`) — it is sent per-request in the
   `X-Anthropic-Api-Key` header and never stored.
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
| Backend port | `backend/src/main/resources/application.properties` | 8080 |
| Max upload size | same file | 20 MB per file |
| Backend URL used by frontend | `NEXT_PUBLIC_API_BASE_URL` env var | `http://localhost:8080` |
| CORS allowed origins | `backend/.../CorsConfig.java` | `*` (dev only — restrict before deploying) |

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
