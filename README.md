# Newtonite Operations Desk

Assessment-sized full-stack workspace for coordinating operational requests that need investigation, action, approval, or resolution.

## Tech Stack

- Frontend: React 19, Vite, TypeScript
- Backend: Node.js, Express, TypeScript
- Persistence: Local JSON store
- Testing: Vitest and Supertest
- Validation: Oxlint and TypeScript build checks

## Architecture

The application consists of a React/Vite frontend and a Node.js API. The frontend communicates with the API for all work-item operations. Authorization, workflow rules, concurrency checks, idempotency, and audit recording are enforced by the API rather than by the UI.

```text
Browser
	|
	v
React / Vite frontend
	|
	| HTTP API
	v
Node.js / Express API
	|
	+-- Resource authorization
	+-- Workflow validation
	+-- Version and idempotency checks
	+-- Audit history
	+-- Notification job processing
	|
	v
Local JSON persistence
```

## Reliability Behaviours

The implementation deliberately demonstrates correctness beyond simple CRUD:

1. **Resource-level authorization**  
	Every protected API operation checks the actor's team membership and role. Operators cannot access or edit work belonging to another team.

2. **Optimistic concurrency**  
	Mutations include the work-item version the user saw. A stale mutation returns `409 Conflict` with the current server representation instead of overwriting newer data.

3. **Idempotent claims**  
	Retrying the same claim request with the same idempotency key returns the original result without another transition or duplicate audit event.

4. **Competing claims**  
	If two operators attempt to claim the same unassigned work item, only the first successful command owns it; the other receives `409 Conflict`.

5. **Audit history**  
	Creation, assignment, status, priority, and decision changes are recorded and shown in the item's activity history.

6. **Server-side query behavior**  
	Search, filtering, sorting, and pagination are performed by the API, so the browser does not load the complete dataset to construct the queue.

## 1. Prerequisites

- Node.js 20 or newer
- npm 10 or newer

## 2. Installation

From the project root:

```powershell
npm install
```

## 3. Environment variables

No environment variables are required for local review. The frontend expects the API at `http://localhost:4000/api`; the API listens on port `4000` and Vite uses port `5173`.

## 4. Database setup

The assessment build uses a local JSON persistence file at `data/store.json` for simplicity and inspectability. It is created and seeded automatically on first API request. The file is ignored by Git. Delete it to reset the demo data.

## 5. Run the frontend and backend

Run both together:

```powershell
npm run dev
```

Or run them separately:

```powershell
npm run dev:api
npm run dev:web
```

Open `http://localhost:5173` after the servers start.

## 6. Demo workflow

The dashboard automatically selects the highest-priority item, `Refund request needs approval`, so the reviewer immediately sees its description, priority, status, owner, team, version, and activity history.

From the detail panel, a reviewer can claim work, assign an eligible team member, change status, change priority, and save a decision. `Resolved / approved` and `Blocked / rejected` make the decision path visible in the history. The user selector is a local identity switch for demonstration only.

## 7. Tests and validation

```powershell
npm test
npm run build
npm run lint
```

The automated tests cover resource authorization, stale-version conflicts, idempotent repeated claims, competing claims by two operators, and audit history for workflow decisions. The intended submission check is:

```text
npm install -> npm run dev -> npm test -> npm run build -> npm run lint
```

To demonstrate the reliability behaviors manually, use two browser windows or switch identities in the header. Open the same unassigned item as Noah and Ava, claim it as one user, then attempt the claim as the other. For stale data, submit an API update with an older `if-match-version`; the server returns `409` and the current item.

## 8. Demo users / credentials

There are no passwords in this local demonstration. Use the identity selector in the header:

- Ava Patel: Operations manager
- Noah Williams: Operations and Engineering operator
- Maya Chen: Finance operator
- Ravi Singh: Administrator

The API uses the local `x-user-id` header. A real deployment would replace this with authenticated SSO/session identity.

## 9. Known limitations

This is intentionally a one-day assessment build, not a production-complete enterprise platform. The JSON store should be replaced with PostgreSQL transactions for multi-process concurrency. Authentication, comments, attachments, full-text indexing, real notification delivery, and a distributed queue are not included. The notification worker is local and bounded; a production version would use an outbox table, durable queue, retry backoff, and dead-letter handling.

See [ENGINEERING_DECISIONS.md](ENGINEERING_DECISIONS.md) for the architecture trade-offs and next steps.
