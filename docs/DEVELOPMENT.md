# Development and Operations

## Prerequisites

- Node.js 22.12 or newer
- npm
- A modern browser with WebGL 2
- Chrome or Chromium for Puppeteer QA
- Optional: an OpenAI API key
- Optional: MetaPerson credentials
- Optional: a Linux/NVIDIA LAM worker

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

The server listens on `127.0.0.1:4173` by default. Vite loads `.env` at startup,
so restart the server after changing server-side variables.

Do not commit `.env`, `.robosa-data/`, QA screenshots, or exported personal
media. They are excluded by `.gitignore`.

## Environment variables

| Variable                           | Required | Purpose                                                   |
| ---------------------------------- | -------- | --------------------------------------------------------- |
| `OPENAI_API_KEY`                   | No       | Enables model-enhanced grounded chat                      |
| `ROBOSA_OPENAI_MODEL`              | No       | Responses API model; defaults to `gpt-5-nano`             |
| `ROBOSA_DATA_DIR`                  | No       | Metadata and avatar directory; defaults to `.robosa-data` |
| `ROBOSA_METAPERSON_CLIENT_ID`      | No       | MetaPerson OAuth client ID                                |
| `ROBOSA_METAPERSON_CLIENT_SECRET`  | No       | MetaPerson OAuth client secret                            |
| `ROBOSA_METAPERSON_DOWNLOAD_HOSTS` | No       | Extra comma-separated trusted export hosts                |
| `ROBOSA_LAM_WORKER_URL`            | No       | Base URL for the self-hosted worker                       |
| `ROBOSA_LAM_WORKER_TOKEN`          | No       | Worker bearer token                                       |
| `ROBOSA_LAM_WORKER_TOKEN_FILE`     | No       | Alternative file containing the worker token              |
| `HOST`                             | No       | Local bind address                                        |
| `PORT`                             | No       | Local port; defaults to `4173`                            |

Prefer `ROBOSA_LAM_WORKER_TOKEN_FILE` on development machines so the token is
not copied into shell history. If both worker token variables exist, the direct
token value takes precedence.

## Project layout

```text
robosa.html                  browser entry
robosa.css                   application styles
src/robosa/                  browser app, renderers, voice, and tests
server/providers/robosa/     HTTP, domain, persistence, and providers
server/providers/common/     minimal shared request body reader
deploy/lam-worker/           self-hosted reconstruction worker
public/                      bundled fallback avatar assets
docs/                        product and engineering documentation
.robosa-data/                private local state, ignored by Git
```

Read [Architecture](ARCHITECTURE.md) before changing ownership boundaries and
[API Reference](API.md) before changing browser/server contracts.

## Development commands

```bash
npm run dev
npm test
npm run build
npm run format
npm run format:check
```

The production build writes to `dist/`. Large renderer chunks are expected in
the prototype because the LAM renderer and Three.js ship in the browser bundle.
Future performance work should dynamically import each appearance renderer from
the selected avatar mode.

## Tests

`npm test` runs Node's built-in test runner over `src/robosa/*.test.mjs`.
Coverage includes:

- profile and handle normalization
- deterministic grounded answers
- session, registration, and password behavior
- booking and conversation rules
- private/public visibility
- avatar file isolation and delivery
- portrait signatures and LAM archive structure
- MetaPerson host and GLB validation
- LAM worker submission/import behavior
- Oculus, VRM, jaw, and ARKit expression mappings
- Open-LLM-VTuber protocol handling
- clean browser route resolution

Tests use temporary directories and must never point at `.robosa-data`.

## Browser QA

Start the development server first. The simulated generation and portrait
checks can then run directly:

```bash
npm run qa:avatar
npm run qa:portrait
```

The saved LAM check needs an authenticated owner cookie and a handle whose
profile has a ready LAM archive. Create the cookie with a local login request:

```bash
curl -c /tmp/robosa-lam-cookie.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"OWNER_EMAIL","password":"OWNER_PASSWORD"}' \
  http://127.0.0.1:4173/api/robosa/auth/login

ROBOSA_QA_HANDLE=owner-handle npm run qa:lam
```

The script verifies desktop/mobile overflow, a nonblank canvas, LAM readiness,
idle motion, speech motion, and console errors. Screenshots are written under
`/tmp` by default.

## Working with local data

### Back up

Stop writes or stop the dev server, then copy the entire data directory. The
database and binary files form one logical snapshot.

```bash
cp -R .robosa-data .robosa-data.backup
```

### Restore

Stop the server, replace `.robosa-data` with the snapshot, and restart. Profile
metadata points to owner-derived filenames, so restoring only `database.json`
can leave published assets missing.

### Reset

Deleting `.robosa-data` removes all local owners, sessions, bookings,
conversations, and published avatars. Device-local capture media in browser
IndexedDB is separate and must be cleared through the browser or studio.

## Adding an API feature

1. Put business validation and state transitions in `service.js`.
2. Put provider/network behavior in its own adapter module.
3. Keep `api.js` responsible for HTTP matching and response translation.
4. Add request parsing or reusable policy to `http.js` or `uploads.js`.
5. Return public shapes that omit secrets and storage paths.
6. Add domain tests and at least one route-level test.
7. Update `API.md` and any affected flow documentation.

## Adding an avatar mode

An animated stage implements the renderer methods consumed by `main.js`:

- create/mount into a supplied host
- report rig readiness when relevant
- accept speaking and viseme updates
- resize without shifting the page layout
- dispose animation frames, WebGL objects, audio hooks, and object URLs

Keep generation separate from playback. Generated output must be validated and
stored through the server before a public profile references it.

## Production checklist

Before exposing Robosa publicly:

1. Move users, profiles, sessions, jobs, bookings, and conversations to a
   transactional database with migrations and backups.
2. Move avatars to encrypted object storage with short-lived delivery URLs.
3. Persist generation jobs so server restarts do not orphan them.
4. Add email verification, password recovery, session revocation, and owner
   account deletion.
5. Replace in-memory limits with a trusted-proxy-aware distributed limiter.
6. Add CSRF tokens or strict Origin/Referer policy for every browser mutation.
7. Add content scanning, media dimension/duration limits, consent audit records,
   abuse reporting, and takedown handling.
8. Run the API behind HTTPS with explicit host and proxy configuration.
9. Add structured logs, metrics, tracing, alerts, and redaction tests.
10. Complete a license review for LAM weights, generated avatars, voices, and
    every production model/provider.
