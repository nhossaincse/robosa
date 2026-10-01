# MVP Status

## Product promise

Robosa lets a person publish an owner-controlled AI representative at a stable
handle. The representative can explain approved work and projects, speak its
answers through a selected visual twin, and collect meeting requests without
claiming to be the person or exposing private calendar details.

## Implemented

- Owner registration, login, logout, and seven-day HTTP-only sessions
- Unique public handles and `/<handle>` profile routes
- Server-persisted profiles, recent conversations, and meeting requests
- Public, unlisted, and private profile visibility
- Deterministic owner-approved answers with optional OpenAI enhancement
- Pending, approved, and declined meeting request states
- Browser recognition and synthetic speech
- Optional Open-LLM-VTuber WebSocket conversation/audio adapter
- Interactive Three.js GLB/VRM avatars
- Oculus visemes, VRM mouth expressions, jaw fallback, gaze, and blink
- LAM Gaussian portrait playback with 52 ARKit expression channels
- Static portrait publication without artificial crop scaling
- Private generated asset storage and visibility-aware delivery
- MetaPerson iframe generation/export integration
- Self-hosted asynchronous LAM worker integration
- Device-local capture photos and videos in IndexedDB
- Desktop and mobile studio/public layouts

## Deliberate behavior

- The twin labels itself as an AI representative.
- Chat uses only owner-approved profile knowledge.
- Unknown questions receive an explicit not-approved answer.
- The twin can request a meeting but cannot confirm one.
- Raw source media remains on the owner's device unless a flow explicitly
  uploads it.
- A static portrait does not pretend to have lip sync.

## Prototype limitations

- The JSON store supports one local Node process, not horizontal scaling.
- LAM job ownership and rate limits are held in memory.
- Email addresses are not verified and there is no password recovery.
- Booking approval does not send messages or create calendar events.
- Knowledge is manually entered; document ingestion and retrieval are absent.
- Browser speech synthesis provides approximate text-paced visemes rather than
  phoneme timestamps.
- Open-LLM-VTuber endpoints are device-local settings. A visitor cannot reach an
  owner's `127.0.0.1` runtime.
- LAM's released weights are not licensed for commercial use.
- There is no production audit, moderation, takedown, or consent ledger yet.

## Milestone sequence

### 1. Durable private beta

- Postgres data model and migrations
- Encrypted object storage
- Persistent avatar job records
- Email verification and password recovery
- Centralized rate limiting and production observability

### 2. Useful assistant

- Permission-scoped document ingestion and retrieval
- Calendar OAuth and free/busy lookup
- Owner approval workflow for actual event creation
- Email notifications and visitor confirmations

### 3. Production voice and avatar

- Hosted low-latency speech gateway
- TTS audio with timed visemes
- Commercially licensed portrait reconstruction path
- Consent receipts, generator provenance, watermarking, and takedown tools

### 4. Delegated actions

- Explicit per-tool permissions and confirmation rules
- Auditable task execution
- Revocation, spending limits, and owner review queues

Delegated actions should not be added directly to chat prompts. They need a
separate capability model, typed tool contracts, and durable audit records.
