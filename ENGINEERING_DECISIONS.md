# Engineering decisions

This document records the main product and engineering trade-offs for the Newtonite Operations Under Pressure assessment. The goal was a coherent, reviewable first version that demonstrates reliability beyond CRUD within a one-day implementation window.

## 1. A focused vertical slice over a broad platform

The application centers on the daily operational review loop: find work, understand why it exists, see who owns it, review what happened, make the next decision, and retain that decision in history. The first screen automatically opens the highest-priority item so the review path is visible immediately.

I intentionally did not build unrelated modules such as chat, attachments, or a separate reporting product. This keeps the core workflow complete rather than spreading effort across incomplete features.

## 2. API-enforced resource authorization

The API derives the actor from the request identity and checks team membership for every protected read and write. An operator can work with unassigned items in their teams or items assigned to them; managers and administrators have broader permissions. Assignees must also belong to the work item's team.

The UI may hide or show actions for usability, but it is not the security boundary. A direct API request with an unauthorized team or resource is rejected by the server. In a production deployment, the local identity header would be replaced with an authenticated SSO/session principal.

## 3. Optimistic concurrency for stale edits

Every work item has a monotonically increasing `version`. A mutation must include the version the user saw. If another user has changed the item, the server returns `409 Conflict` and includes the current representation. This prevents an older browser view from silently overwriting a newer assignment, status, priority, or decision.

This is a deliberate fit for the workflow: work items are edited occasionally, and a visible conflict is safer than silently merging two operational decisions. The UI exposes the current version in the detail panel and sends the version with every save.

## 4. Idempotency and competing assignment commands

Claiming work is modeled as a command, not merely as a generic update. The API accepts an `Idempotency-Key` and stores the successful result. If a client retries because the first response was lost, the same command returns the same result without creating another transition or audit event.

The assignment check also rejects a claim when another user already owns the item. The test suite covers both cases: repeated requests by one user and competing claims by two users. This addresses duplicate requests and concurrent ownership changes explicitly.

## 5. Audit history as part of the primary write

Important changes record an audit event at mutation time: creation, claiming, assignment, status, priority, and decision changes. The detail view displays this history alongside the current state, so the reviewer can understand both what requires attention next and why the item is in its current state.

The audit event is written as part of the same local persistence operation as the work-item mutation. This keeps the local model consistent. A production database would use a transaction and indexed audit tables.

## 6. Synchronous decisions, asynchronous notifications

The user-facing work-item mutation is synchronous because the caller needs an authoritative version and result immediately. Assignment notification is secondary, so it is represented as a job after the primary mutation succeeds. A small local worker processes pending jobs and records a bounded `sent` or `failed` outcome.

This demonstrates the failure boundary without making notification delivery block the operational decision. In production, this would become a transactional outbox plus a durable queue with exponential retry backoff and dead-letter handling.

## 7. Local persistence and scale trade-off

A JSON store keeps the assessment easy to install, inspect, reset, and demonstrate without external infrastructure. The API still applies server-side filtering, sorting, and pagination rather than loading the full dataset into the browser.

The trade-off is that JSON file writes are not suitable for multiple API processes or high-volume concurrent production traffic. The next scale step would be PostgreSQL transactions, indexes for team/status/priority/time queries, a search index for text, and session-backed authentication. The API boundaries are kept explicit so those infrastructure changes would not require moving workflow rules into the frontend.

## Deliberate limitations

This is not presented as a production-complete enterprise platform. Authentication, comments, attachments, real email or chat delivery, full-text indexing, and distributed job processing are intentionally outside the one-day scope. They are documented limitations rather than hidden assumptions, while the implemented slice covers the assessment's highest-risk behaviors and includes automated evidence for them.
