# Notification worker: safe dry-run checklist

This checklist is for reviewing the worker without delivering SMS or WhatsApp messages.

## Current status

- The worker code lives in `notification-worker.js`.
- The dry-run mode is enabled only when `NOTIFICATION_DRY_RUN=true`.
- In dry-run mode, the worker requires `DATABASE_URL`, reads grouped counts from `notification_outbox`, and does not claim, update, or send queue items.
- WhatsApp delivery remains disabled.
- Do not merge this change or create a Render worker service as part of this checklist without reviewing the PR and confirming any potential hosting cost.

## Dry-run configuration (do not enable sending)

Only proceed after an isolated test database has been explicitly prepared. Do not create a paid worker service or connect to production just to perform this check. If no isolated database is available, keep using the mocked database tests.

- Build command: `npm install`
- Start command: `node notification-worker.js`
- `DATABASE_URL`: a dedicated, isolated test database connection string, configured as a secret. Never use the production Neon database for this test.
- `NOTIFICATION_DRY_RUN`: `true`

Do not set `NOTIFICATION_SEND_ENABLED=true`. Do not add Twilio credentials for a dry-run. Do not use the web service's `npm start` command for the worker, because that starts `server.js` instead.

## Acceptance checks

1. Startup log says: `Notification worker started in DRY RUN mode. No messages will be claimed or sent.`
2. Periodic logs show only aggregate counts by status and channel.
3. No Twilio request is made and no outbox row changes status, attempts, timestamps, or provider fields.
4. Stop the worker if the table is missing or the database connection fails; investigate before any real delivery is considered.

## Ambiguous delivery outcomes and manual review

- A network timeout, connection failure, provider HTTP 5xx, successful response without a provider message SID, or database failure while recording a provider acceptance is treated as an uncertain outcome.
- To avoid automatic duplicate messages, the worker exhausts the retry budget for an uncertain outcome. Stale `processing` leases are also marked failed with the retry budget exhausted rather than re-queued automatically.
- These rows need manual reconciliation against the provider's message logs before any retry. Do not reset `attempts`, change the status to `pending`, or resend merely because the row is marked `failed`: `failed` can mean delivery is unknown, not that the provider definitely rejected it.
- This is a conservative duplicate-prevention measure, not a guarantee of exactly-once delivery. It can leave a notification unsent until a person reconciles it.

## Before real delivery

Real delivery is a separate, explicitly approved change. It requires provider setup, verified consent and phone numbers, controlled test recipients, delivery/error monitoring, a documented manual reconciliation process, and a reviewed retry/duplicate-delivery policy. This checklist does not authorize sending messages or connecting the worker to the production database.
## Concurrent appointment changes

- The worker re-checks appointment status, slot, patient consent, and the current patient phone immediately before calling the messaging provider.
- A small race remains between that final database read and the provider accepting the message: an appointment can be cancelled or rescheduled during that interval. The worker does not hold a database transaction open across the network request, because doing so could block appointment updates for the provider timeout window.
- Therefore the pre-send check reduces stale notifications but cannot guarantee that no message is sent during a simultaneous cancellation/reschedule. Do not describe delivery as exactly-once or race-free. For any reported stale message, reconcile the outbox row against the provider message log and appointment audit trail.
- A future stronger guarantee would require provider-supported idempotency/cancellation semantics or a separately designed delivery protocol; do not attempt to solve this by force-cancelling a `processing` row while a provider request may be in flight.
