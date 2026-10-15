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

## Before real delivery

Real delivery is a separate, explicitly approved change. It requires provider setup, verified consent and phone numbers, controlled test recipients, delivery/error monitoring, and a reviewed retry/duplicate-delivery policy. This checklist does not authorize sending messages or connecting the worker to the production database.
