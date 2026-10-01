# Robosa

Robosa is an owner-controlled digital twin studio. An owner publishes approved
profile knowledge, chooses a visual twin, and shares a handle such as
`/nazmul`. Visitors can ask questions, hear spoken answers, and submit meeting
requests without the twin pretending to be the human owner.

This repository is a working local prototype. It includes authentication,
profile persistence, grounded chat, browser voice, LAM portrait playback,
GLB/VRM playback, and a self-hosted LAM worker adapter. The local JSON store and
in-memory job/rate-limit state must be replaced before a production launch.

## Quick start

Requirements: Node.js 22.12 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

- Studio: <http://127.0.0.1:4173/studio>
- Public twin: `http://127.0.0.1:4173/<handle>`

An OpenAI key is optional. Without one, Robosa answers from its deterministic,
owner-approved knowledge engine. LAM and MetaPerson generation are also
optional; imported avatars and the bundled demo remain available.

## What is included

- Owner registration, sign-in, HTTP-only sessions, and public handle claims
- Identity, project knowledge, visibility, voice, and booking controls
- Public grounded chat with optional OpenAI Responses API enhancement
- Browser speech recognition and speech synthesis
- Optional Open-LLM-VTuber WebSocket speech runtime
- LAM Gaussian portrait rendering with 52 ARKit expression channels
- Interactive Three.js GLB/VRM rendering with Oculus, VRM, or jaw lip sync
- Static portrait publishing without simulated mouth deformation
- Private local avatar storage with visibility-aware delivery
- Asynchronous self-hosted LAM GPU worker integration

## Technology

- Browser: Vite, vanilla JavaScript, CSS, Three.js, `@pixiv/three-vrm`
- Facial animation: LAM WebRender adapter, HeadAudio, Web Audio API
- Server: Node.js middleware mounted into Vite for this prototype
- Persistence: atomic JSON metadata plus private files in `.robosa-data/`
- GPU worker: Python, FastAPI, upstream LAM, and Blender conversion tools
- Optional AI: OpenAI Responses API and Open-LLM-VTuber

## Commands

```bash
npm run dev             # local app on port 4173
npm test                # unit, domain, and API tests
npm run build           # production browser bundle
npm run format:check    # formatting verification
npm run qa:lam          # rendered LAM desktop/mobile check
npm run qa:portrait     # static portrait check
npm run qa:avatar       # generated 3D avatar check
```

The QA scripts expect the development server to be running. Some use local
session fixtures described in [Development](docs/DEVELOPMENT.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [Development and operations](docs/DEVELOPMENT.md)
- [Avatar and lip-sync pipeline](docs/ROBOSA-AVATAR-PIPELINE.md)
- [MVP status and roadmap](docs/ROBOSA-MVP.md)
- [LAM worker deployment](deploy/lam-worker/README.md)

## Local data

Robosa writes private development data to `.robosa-data/` by default:

```text
.robosa-data/
  database.json
  avatars/
    <owner-hash>.glb
    <owner-hash>.portrait
    <owner-hash>.lam.zip
```

The directory and `.env` are ignored by Git. Back up `.robosa-data/` before
moving machines or deleting a development environment. Set `ROBOSA_DATA_DIR`
to move it to another local volume.

## Important boundaries

- A public twin is an AI representative, not the human owner.
- Raw capture photos and videos remain in browser IndexedDB unless explicitly
  uploaded for portrait publishing or LAM generation.
- LAM's released model weights are noncommercial evaluation assets. Review the
  licensing section in the avatar pipeline before commercial deployment.
- Meeting approval updates Robosa state only; it does not yet create a calendar
  event or send email.
