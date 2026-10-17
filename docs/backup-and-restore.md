# Backup and restore guide

This guide separates source-code backups from PostgreSQL data backups. A GitHub ZIP is **not** a database backup, and a database dump does not contain the source code or deployment configuration.

## 1. Save a copy of the source code (Windows)

1. Open the repository's [integration branch](https://github.com/mahirco066/medical-booking/tree/integration/notification-worker-main-sync).
2. Choose **Code → Download ZIP** and save the ZIP in a safe local folder. Alternatively, download the ZIP for the `main` branch if you specifically need the production branch.
3. Keep at least two copies in separate locations. Do not put credentials, `.env` files, database dumps, patient records, or provider secrets in the repository or a public cloud folder.
4. Record which branch and commit were saved. A source archive does not include Git history.

## 2. Back up the Neon PostgreSQL database

Do this from a trusted computer with PostgreSQL command-line tools installed. The person performing the backup should obtain the connection string directly from the Neon dashboard or the approved secret store. **Never paste the connection string into chat, commit it to Git, or print it in logs.**

In a fresh PowerShell window, set the connection string as a session-only environment variable by entering it locally (the value is a secret and should not be shared):

```powershell
$env:DATABASE_URL = Read-Host "Paste the Neon connection string locally (input will be visible)"
```

Because `Read-Host` displays typed text, use a trusted private computer and avoid screen sharing. For a less exposed workflow, set the variable through your approved local secret manager instead.

Create a custom-format dump. Replace the date in the filename with the current date:

```powershell
pg_dump --format=custom --no-owner --no-privileges --file="medical-booking-2026-10-16.dump" "$env:DATABASE_URL"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed; do not treat this file as a valid backup." }
Get-Item ".\medical-booking-2026-10-16.dump" | Select-Object Name, Length
```

Store the dump securely with restricted access. It may contain sensitive patient and appointment information. Do not upload it to GitHub. Confirm that the file exists and has a plausible non-zero size, but remember that only a restore test can establish that the dump is usable.

If `pg_dump` is not recognized, install PostgreSQL client tools matching a compatible PostgreSQL version, then open a new PowerShell window. Do not run the backup command against a test database by accident.

## 3. Test restoration into a separate, empty database

Restore to a **new or specifically designated recovery database**, never directly over production for a routine test. Obtain its connection string from the database provider and set it locally:

```powershell
$env:RESTORE_DATABASE_URL = Read-Host "Paste the dedicated restore-database connection string locally (input will be visible)"
```

Then run:

```powershell
pg_restore --no-owner --no-privileges --dbname="$env:RESTORE_DATABASE_URL" ".\medical-booking-2026-10-16.dump"
if ($LASTEXITCODE -ne 0) { throw "pg_restore reported an error; inspect it before using this recovery database." }
```

This basic restore is intended for a fresh, empty target. If you deliberately need to replace objects in a dedicated recovery database, `pg_restore --clean --if-exists` can drop existing objects first; **it can destroy data in the target**. Verify the target database name and connection string before using those flags. Never run destructive restore options against production as an experiment.

After restoring, verify tables and key records with an authorized operator, and test the application against the recovery database using a separate test deployment or local configuration. Never point test traffic at production unintentionally.

## 4. Recover the application

1. Extract the saved source ZIP or check out the recorded commit.
2. Configure the required environment variables in the deployment platform's secret settings, not in source files. At minimum, review `DATABASE_URL` and the administrator credentials expected by the current application. Check the current source and Render configuration for the exact names required.
3. Confirm that the chosen database is the intended production or recovery database before deploying.
4. Deploy to a test service first when restoring from backup. Check health, login, doctor schedules, appointment creation, and administrative workflows before considering a production switch.
5. Keep the original database and its backup untouched until the recovery is verified.

## 5. Notification safety during recovery

Keep real sending disabled while restoring or testing. Do not set `NOTIFICATION_SEND_ENABLED=true`, add Twilio secrets, or enable live SMS/WhatsApp delivery as part of a routine restore. Test the notification worker in dry-run mode and confirm the outbox remains unchanged before separately reviewing any live-delivery rollout.

## Backup checklist

- [ ] Source ZIP saved, with branch and commit recorded.
- [ ] PostgreSQL dump created successfully and stored securely outside GitHub.
- [ ] Restore tested against a separate database.
- [ ] Required environment-variable names documented; secret values kept out of source control.
- [ ] Application smoke tests passed against the intended database.
- [ ] Live notification sending remains disabled until explicitly approved.

**Important:** This document describes the procedure only. It does not mean that a database export or restore has already been performed.
