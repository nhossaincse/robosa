# API Reference

## Conventions

The prototype API is mounted at `/api/robosa`. JSON requests use
`Content-Type: application/json`. Binary upload endpoints receive the file as
the complete request body.

Successful JSON responses are endpoint-specific. Errors always use:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Human-readable explanation."
  }
}
```

Authentication uses the `robosa_session` HTTP-only cookie. The cookie lasts
seven days, uses `SameSite=Lax`, and gains `Secure` when the request is HTTPS or
has `X-Forwarded-Proto: https`.

All state-changing requests are rejected when their `Origin` host differs from
the request `Host`. Requests without an `Origin` header are accepted for
non-browser clients, so production infrastructure must control direct API
access and forwarded headers.

## Endpoint summary

| Method     | Path                               | Authentication | Purpose                              |
| ---------- | ---------------------------------- | -------------- | ------------------------------------ |
| `POST`     | `/auth/register`                   | Public         | Create owner, profile, and session   |
| `POST`     | `/auth/login`                      | Public         | Start an owner session               |
| `POST`     | `/auth/logout`                     | Optional       | Remove the current session           |
| `GET`      | `/session`                         | Optional       | Read owner session state             |
| `PUT`      | `/profile`                         | Owner          | Update approved profile and settings |
| `GET`      | `/bookings`                        | Owner          | List the latest 50 requests          |
| `PATCH`    | `/bookings/:id`                    | Owner          | Approve or decline a request         |
| `POST`     | `/avatar/metaperson/token`         | Owner          | Mint a short-lived provider token    |
| `POST`     | `/avatar/metaperson/import`        | Owner          | Import an exported provider GLB      |
| `PUT`      | `/avatar/portrait`                 | Owner          | Publish a static portrait            |
| `PUT`      | `/avatar/lam`                      | Owner          | Import a completed LAM ZIP           |
| `POST`     | `/avatar/lam/jobs`                 | Owner          | Submit a portrait to the LAM worker  |
| `GET`      | `/avatar/lam/jobs/:id`             | Owner          | Poll and import a worker result      |
| `GET`      | `/profiles/:handle`                | Visibility     | Read a public twin profile           |
| `POST`     | `/profiles/:handle/chat`           | Visibility     | Send a visitor message               |
| `POST`     | `/profiles/:handle/bookings`       | Public         | Submit a meeting request             |
| `GET/HEAD` | `/profiles/:handle/avatar.glb`     | Visibility     | Read the published 3D model          |
| `GET/HEAD` | `/profiles/:handle/portrait`       | Visibility     | Read the published portrait          |
| `GET/HEAD` | `/profiles/:handle/avatar.lam.zip` | Visibility     | Read the published LAM archive       |

`Visibility` means public and unlisted profiles are accessible without a
session. A private profile is accessible only to its signed-in owner.

## Accounts

### Register

```http
POST /api/robosa/auth/register
Content-Type: application/json
```

```json
{
  "email": "owner@example.com",
  "password": "at least ten characters",
  "handle": "owner-handle",
  "profile": {
    "displayName": "Owner Name",
    "headline": "What the owner does",
    "bio": "Owner-approved introduction",
    "projects": [{ "name": "Project", "summary": "Description" }],
    "facts": ["Approved fact"],
    "allowBooking": true,
    "speakReplies": true,
    "visibility": "public"
  }
}
```

Returns `201`, sets the session cookie, and returns `{ user, profile }`.
Handles are 2-40 letters, numbers, or hyphens after normalization. Passwords
must contain 10-256 characters. Email ownership is not yet verified.

### Login and logout

`POST /auth/login` accepts `{ "email", "password" }`, returns `{ user,
profile }`, and sets a new session cookie. `POST /auth/logout` returns
`{ "ok": true }` and expires it.

### Session

`GET /session` returns either:

```json
{ "authenticated": false }
```

or `{ "authenticated": true, "user": {...}, "profile": {...} }`.
Public user objects never include password or session data.

## Profile

`PUT /profile` accepts the profile object. The server normalizes lengths,
visibility, handle format, project count, and fact count. Avatar metadata in the
request is ignored; only successful server-side publication updates it.

Profile fields:

| Field          | Constraint                                |
| -------------- | ----------------------------------------- |
| `handle`       | 2-40 normalized characters; unique        |
| `displayName`  | up to 80 characters                       |
| `headline`     | up to 180 characters                      |
| `bio`          | up to 900 characters                      |
| `projects`     | up to 12; name 80, summary 500 characters |
| `facts`        | up to 30; 500 characters each             |
| `avatarMode`   | `lam`, `3d`, or `portrait`                |
| `allowBooking` | boolean                                   |
| `speakReplies` | boolean                                   |
| `visibility`   | `public`, `unlisted`, or `private`        |

## Bookings

Visitors submit:

```http
POST /api/robosa/profiles/owner-handle/bookings
```

```json
{
  "guestName": "Visitor",
  "guestEmail": "visitor@example.com",
  "slot": "Tuesday at 10:00 AM"
}
```

The request starts as `pending`. Owners update it with:

```http
PATCH /api/robosa/bookings/<uuid>
Content-Type: application/json

{ "status": "approved" }
```

The only accepted decisions are `approved` and `declined`. Approval does not
send email or create a calendar event.

## Chat

```http
POST /api/robosa/profiles/owner-handle/chat
Content-Type: application/json
```

```json
{
  "message": "What are you building?",
  "conversationId": "optional-previous-id"
}
```

The message is trimmed to 1,000 characters. A response contains:

```json
{
  "conversationId": "uuid",
  "text": "Owner-approved answer",
  "action": null,
  "mode": "grounded"
}
```

`mode` is `ai` when the optional model returns a usable answer and `grounded`
when the deterministic engine is used. `action` can be `booking` when the UI
should open the meeting request flow.

## Avatar uploads

### Static portrait

`PUT /avatar/portrait` receives raw JPEG, PNG, or WebP bytes. The server checks
the file signature and caps the body at 10 MB. Success returns `201` with the
updated profile and activates portrait mode.

### LAM import

`PUT /avatar/lam` receives raw ZIP bytes, capped at 120 MB. The archive must
contain one common avatar directory with:

```text
skin.glb
animation.glb
offset.ply
vertex_order.json
```

Success returns `201` with the updated profile and activates LAM mode.

### LAM generation job

`POST /avatar/lam/jobs` receives raw portrait bytes and requires an ISO date in
`X-Robosa-Consent-At`. It returns `202` with a worker job:

```json
{
  "job": {
    "id": "avjob_aabbcc",
    "status": "queued",
    "progress": 0
  }
}
```

Poll `GET /avatar/lam/jobs/:id`. When the worker reports `complete`, the server
downloads and validates the archive, stores it privately, publishes its
metadata, asks the worker to delete the job, and includes the updated `profile`
in the response.

Job ownership is held in server memory in this prototype. Restarting the Node
process loses active job tracking even if the GPU worker is still running.

### MetaPerson

`POST /avatar/metaperson/token` returns a short-lived provider token and iframe
URL. After the embedded creator exports a model, `POST
/avatar/metaperson/import` accepts:

```json
{
  "url": "https://approved.avatarsdk.com/model.glb",
  "avatarCode": "provider-reference"
}
```

The server downloads at most 30 MB from an approved HTTPS host, verifies the
GLB header/version, stores the bytes privately, and activates 3D mode.

## Rate limits

Limits are in-memory and reset when the Node process restarts:

| Operation        | Limit                                |
| ---------------- | ------------------------------------ |
| Registration     | 5 per client address per hour        |
| Login            | 10 per client address per 15 minutes |
| Public chat      | 30 per client address per minute     |
| Meeting request  | 10 per client address per hour       |
| MetaPerson token | 10 per owner per hour                |
| LAM generation   | 5 per owner per hour                 |

`X-Forwarded-For` is trusted as the client address in this prototype. A
production reverse proxy must overwrite, not append untrusted client values.

## Common status codes

- `400`: invalid fields, JSON, consent, handle, or worker response
- `401`: owner session required or invalid credentials
- `403`: cross-origin mutation rejected
- `404`: profile, booking, avatar, endpoint, or tracked job not found
- `409`: duplicate email/handle or conflicting worker operation
- `413`: JSON, portrait, model, or archive exceeds its cap
- `415`: unsupported portrait/model/archive bytes
- `429`: prototype rate limit reached
- `502`: configured external provider failed
- `503`: optional provider or worker is not configured
