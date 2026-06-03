# Bead 34 — Invite / Access UX: Architecture Review

**Reviewer role:** Architect (pre-implementation gate)
**Date:** 2026-06-04
**Status:** Review only — no files edited.
**Scope under review:** invite links, collaborator list, roles/scopes, revoke, expiry, copy-link, and an invited collaborator opening a Lash doc with capabilities matching `comment` / `suggest` / `edit` scope.
**Explicitly out of scope:** Riddle integration (deferred), real user auth/SSO.

---

## 1. Context & Current State

Beads 28–33 shipped the Cloudflare Durable Object realtime stack: signed session grants, Yjs persistence, large-doc perf, and actor-ID-based presence. Bead-33's own handoff note states the intent precisely:

> "Presence is intentionally actor-ID based until Bead 34 introduces real invite/access UX, profiles, roles, revoke/expiry, and collaborator management."

The repository today contains **two parallel, unconnected access-control systems**. Bead 34's central architectural task is to bridge them. Neither currently gates who can open a doc or with what capability.

### System A — `@lash/share` + `@lash/rbac` (rich, but inert)

| Piece | Location | Reality |
|---|---|---|
| `ShareToken` (4 scopes, jti, redactionPolicy, nullable expiry) | `packages/types/src/index.ts:233` | Typed contract, frozen |
| `createShareSigner` (sign/validate/revoke + audit) | `packages/share/src/index.ts:70` | Keyed SHA-256 via `hashCanonical`, **issued tokens held in an in-process `Map`** |
| `capabilitiesForScope` (scope → rich capability set) | `packages/rbac/src/index.ts:103` | Pure, correct, least-privilege |
| `createPolicyEngine.decide` | `packages/rbac/src/index.ts:62` | Sound; anonymous → `no-access` |
| `SharePanel` UI | `apps/web/components/editor/panels/SharePanel.tsx` | **Demo only** |

The `SharePanel` signs a token with a **hardcoded `secret: 'local-share-secret'` in the browser bundle** (`SharePanel.tsx:57`), immediately re-validates it in the same component for display, and **never produces a URL, never gates the editor**. Revocation and audit use `createMemoryRevocationStore()` / in-memory audit (`SharePanel.tsx:51-52`) — per-tab, lost on reload.

### System B — `packages/realtime-worker` (real transport gate, too coarse)

| Piece | Location | Reality |
|---|---|---|
| `RealtimeSessionGrant` (2 caps: `doc.read`/`doc.edit`, **required** expiry, real HMAC) | `packages/realtime-worker/src/access.ts:3` | Server-side, WebCrypto HMAC-SHA256 |
| `room-session` route | `packages/realtime-worker/src/index.ts:94` | **Mints `createDefaultRealtimeGrant` (read+edit) for ANY actorId — zero authorization** |
| `room-socket` route | `packages/realtime-worker/src/index.ts:117` | Requires `doc.edit` to open the socket |
| Room DO socket handler | `packages/realtime-worker/src/room.ts:281` | Accepts `yjs-update` from any connected socket — **no per-capability enforcement** |

The browser calls the session endpoint with **only an `actorId`** (`apps/web/lib/realtimeCollaboration.ts:299`) and receives a full read+edit grant. This was acceptable for single-user local realtime; Bead 34 is exactly the bead that must close it.

---

## 2. Key Findings (architecture gaps)

1. **The two systems share nothing.** `ShareScope` (`view/comment/suggest/edit`) never reaches the worker, which only understands `doc.read`/`doc.edit`. Share links are currently theater.
2. **The session endpoint is an open door.** `createDefaultRealtimeGrant` (`access.ts:122`) hands edit access to anyone who knows a room id. This is the single highest-priority change.
3. **Capability vocabulary is too coarse for the scopes.** The socket route (`index.ts:117`) requires `doc.edit`, so `view`/`comment`/`suggest` holders **cannot even connect** today. The realtime layer needs at least a read-vs-write distinction and a way to carry scope.
4. **Sub-edit scopes are not server-enforceable as designed.** Comments and suggestions live *inside* the Yjs document, so `comment`/`suggest`/`edit` all require write access to the CRDT socket. The DO receives opaque binary Yjs updates (`room.ts:isValidYjsUpdate`) and cannot cheaply tell a comment-mark write from a body edit. Distinguishing comment/suggest/edit is therefore **client-trust** unless expensive server-side update introspection is added.
5. **No durable store for invites / collaborators / revocations.** Revocation + audit are in-memory; `documentRegistry.ts` is localStorage-only (`title` + `id`) and client-controlled — it cannot be authoritative for access. There is no per-doc collaborator list anywhere.
6. **Secret in the client bundle.** Any real invite signing must move server-side. The worker already holds `LASH_REALTIME_SESSION_SECRET` (`index.ts:46`).
7. **Expiry semantics differ.** `ShareToken.expiresAt` is nullable; `RealtimeSessionGrant.expiresAt` is required with a 60-min default (`access.ts:21`). A two-tier model reconciles this cleanly.
8. **Editor never reflects scope.** `SharePanel` is mounted as an inert panel (`EditorWorkspace.tsx:1066`); the editor is always fully editable. The acceptance ("capabilities matching scope") requires wiring scope → `editor.setEditable` / suggest-mode / comment-only.

---

## 3. Recommended Implementation Path

Adopt an explicit **two-tier token model**. This is the smallest change that reconciles both systems and is already half-present.

```
  OWNER (edit scope)                          INVITED COLLABORATOR
  ─────────────────                           ────────────────────
  SharePanel "Create link"                    opens /doc/[id]#invite=<inviteToken>
        │                                                │
        │ POST (server-side sign)                        │ exchange invite → session
        ▼                                                ▼
  ┌──────────────────────┐                    ┌────────────────────────────────┐
  │  INVITE (durable)    │  stored in DO  ──▶ │  room-session route             │
  │  jti, scope, expiry, │  per-doc store     │  validate(invite): not revoked, │
  │  createdBy, revoked  │ ◀── revoke/list ── │  not expired, signature ok      │
  │  optional expiry     │                    │  → mint scope-matched GRANT     │
  └──────────────────────┘                    └────────────────────────────────┘
        copy-link returns URL                          │ short-lived (≤60m) HMAC grant
                                                        ▼
                                            socket: read-only OR write,
                                            editor: setEditable / suggest / comment
```

**Tier 1 — Invite (durable, revocable, optional expiry).** Issued and signed **server-side**. The link carries an opaque invite token in the **URL hash** (`#invite=…`, kept out of server logs / Referer) on `documentPath(id)`.

**Tier 2 — Session grant (short-lived, HMAC).** Minted by `room-session` **only after** validating the invite (signature + not-expired + not-revoked) against the durable store. Replaces `createDefaultRealtimeGrant`. Short TTL means revoke takes effect within one session window without server push.

### Concrete steps

1. **Durable per-doc store in the Room DO.** Add SQLite tables alongside the existing Yjs tables (`room.ts` constructor): `invites(jti, scope, expires_at, created_by, created_at, revoked_at)` and `collaborators(actor_id, display_name, scope, last_seen)`. The DO is already the per-doc authority and persists across reload — this is the natural home, not localStorage.
2. **Server-side invite issuance + management routes** on the worker (or a Next route handler proxying it): create-invite (requires an `edit`/`doc.share` grant), list-collaborators, revoke-invite. Reuse `@lash/share` signing but feed it a **durable** `RevocationStore`/`AuditLog` backed by the DO, not `createMemoryRevocationStore`.
3. **Extend the realtime capability vocabulary** so `view → doc.read`, and `comment`/`suggest`/`edit → doc.edit` *plus* carry the original `ShareScope` on the grant. Add a single mapping function (e.g. `realtimeCapabilitiesForScope`) co-located with `capabilitiesForScope` so there is one source of truth.
4. **Gate the socket by read vs write.** Allow `view` to open a **read-only** socket (receives hydration + broadcasts, server rejects inbound `yjs-update`). Today `room-socket` hard-requires `doc.edit` (`index.ts:117`); split into read-accept / write-accept and enforce write rejection in `room.ts:webSocketMessage`.
5. **Bridge invite → session in the client.** `realtimeCollaboration.ts` `sessionUrl` (line ~125) must include the invite token; `/doc/[id]` page must read `#invite`, exchange it, and surface `forbidden`/`expired`/`revoked`.
6. **Reflect scope in the editor.** Map the resolved scope to editability: `view` → `setEditable(false)`; `comment` → comment-only; `suggest` → force suggest-mode; `edit` → full. Wire through `EditorWorkspace` where `SharePanel` is mounted (`EditorWorkspace.tsx:1066`).
7. **Real copy-link + collaborator list UI** in `SharePanel`: build the URL via `documentPath`, render the DO-backed collaborator/invite list with revoke buttons and per-link scope/expiry, replacing the four demo buttons.

---

## 4. Policy / Security Risks

| # | Risk | Severity | Mitigation / Required posture |
|---|---|---|---|
| R1 | `room-session` mints full read+edit for any actorId (`access.ts:122`) | **Critical** | Must not ship Bead 34 without replacing default-grant minting with invite validation. |
| R2 | Sub-edit scopes (comment/suggest) unenforceable server-side over opaque Yjs binary | **High** | Enforce **view (read-only) strictly server-side**; enforce comment/suggest/edit **client-side** and **document explicitly** that a holder of a comment/suggest link can technically push edits over the socket. Residual risk is bounded by: edits are authored, audited, and reversible via history. Server-side Yjs-update introspection = follow-up, out of scope. |
| R3 | Invite signing secret in browser bundle (`SharePanel.tsx:57`) | **High** | Move all signing server-side; never expose `LASH_REALTIME_SESSION_SECRET` or any share secret to the client. |
| R4 | In-memory revocation/audit lost on reload (`SharePanel.tsx:51-52`) | **High** | Back revocation + audit with the DO store; revocation must survive reload and be global to the doc. |
| R5 | `documentRegistry` (localStorage) treated as access source | Medium | Keep it as the owner's local doc list only; access decisions read from the DO, never localStorage. |
| R6 | Bearer-link == capability (no identity binding) | Medium (by design in local mode) | State explicitly: whoever holds the link gets the scope; **revoke + expiry are the only controls**. Optionally bind an invite to the first claiming `actorId` + display name. No real auth is in scope. |
| R7 | Content redaction for `view` over realtime | Medium | The room broadcasts full doc state on connect (`room.ts` hydration). True content redaction over a full-doc Yjs socket is **not achievable** and is out of scope — keep redaction confined to diff/history/chat surfaces (existing behavior). Decide: `view` reads full content, or `view` does not get a realtime socket. |
| R8 | Invite token leakage via URL (logs, Referer, history) | Medium | Use URL **hash** (`#invite=`), not query string; strip after exchange; short session TTL limits blast radius. |
| R9 | Token tamper / signature downgrade | Low (already handled) | Preserve timing-safe compare (`access.ts:67`) and keyed signing; add tamper unit coverage for the new invite path. |

---

## 5. Tests Required

**Unit — `packages/testing/unit/share/` (extend `share-rbac.test.ts`):**
- `realtimeCapabilitiesForScope`: `view→[read]`, `comment/suggest/edit→[edit]+scope tag`; least-privilege preserved.
- Two-tier exchange: valid invite → scope-matched grant; revoked invite → denied; expired invite → denied; tampered invite signature → denied.
- Durable revocation store: revoke survives a fresh store read; audit records `created`/`access`/`revoked`.

**Worker unit — `packages/testing/unit/realtime-runtime/` (extend `realtime-access-boundary.test.ts`):**
- `room-session` refuses to mint a grant without a valid invite (the R1 regression guard).
- `room-session` mints capabilities matching invite scope.
- `room-socket`: `view` grant opens read-only and inbound `yjs-update` is rejected; `edit` grant writes succeed.
- Revoked/expired invite → 403 at session exchange.

**E2E — `apps/web/e2e/share/` (rework existing + add):**
- Existing `share-comment-scope` / `-suggest-scope` / `-edit-scope` / `-expiry` / `-audit`: migrate from the in-place demo to the real **create-link → open-as-collaborator** flow.
- Copy-link produces a working URL; opening it yields editor editability matching scope (view read-only, comment can comment but not edit body, suggest enters suggest-mode, edit full).
- Revoke-then-reload denies access; expiry denies access; collaborator list shows and removes a collaborator.

**Keep unchanged:** existing redaction tests (`apps/web/e2e/privacy/history-redact`, `chat-redact`) — redaction stays on diff/history/chat surfaces.

---

## 6. What Must Stay Out of Scope

- **Riddle integration** — explicitly deferred.
- **Real user auth / SSO / accounts / profiles** beyond a claimed display name. Local model is bearer-link == capability.
- **Email invite delivery** — invites are copy-link only.
- **Server-side fine-grained Yjs mutation validation** (distinguishing comment vs suggest vs edit writes server-side) — record as an explicit follow-up; Bead 34 enforces it client-side with the documented residual risk (R2).
- **Realtime content redaction for `view` scope** — not achievable with full-doc Yjs broadcast (R7).
- **Multi-region / Lamport-distributed grant coordination**, and any change to the frozen `@lash/types` contracts beyond additive grant fields.

---

## 7. Go / No-Go

**Conditional GO**, provided the implementation:
1. Replaces the default-grant minting in `room-session` (R1) — non-negotiable.
2. Moves all signing server-side (R3) and backs revocation/audit with the DO (R4).
3. Explicitly documents the client-trust boundary for comment/suggest scopes (R2) and the view-redaction limitation (R7) in the handoff.

The two-tier invite→session model reuses the existing `@lash/share` signer and the worker grant machinery, so the change is primarily *wiring + durable storage + a read-only socket mode*, not new crypto. That keeps Bead 34 medium-risk and within the established realtime architecture.
