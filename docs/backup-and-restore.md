# Backup and restore guide

This guide separates source-code backups from PostgreSQL data backups. A GitHub ZIP is **not** a database backup, and a database dump does not contain the source code or deployment configuration.

## 1. Save a copy of the source code (Windows)

1. Open the repository's [integration branch](https://github.com/mahirco066/medical-booking/tree/integration/notification-worker-main-sync).
2. Choose **Code → Download ZIP** and save the ZIP in a safe local folder. Alternatively, download the ZIP for the `main` branch if you specifically need the production branch.
3. Keep at least two copies in separate locations. Do not put credentials, `.env` files, database dumps, patient records, or provider secrets in the repository or a public cloud folder.
4. Record which branch and commit were saved. A source archive does not include Git history.

## 2. Back up the Neon PostgreSQL database

Do this from a trusted computer with PostgreSQL command-line tools installed. The person performing the backup should obtain the connection string directly from the Neon dashboard or the approved secret store. **Never paste the connection string into chat, commit it to Git, or print it in logs.**

In a fresh PowerShell window, enter the connection string through a secure prompt. The script briefly places it in the current process environment because `pg_dump` needs it; do not share your screen, print the variable, or save secrets in command history.

```powershell
$secure = Read-Host "Neon connection string (hidden input)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $backupFile = "medical-booking-$((Get-Date).ToString('yyyy-MM-dd')).dump"
  pg_dump --format=custom --no-owner --no-privileges --file="$backupFile" "$env:DATABASE_URL"
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed; do not treat this file as a valid backup." }
  Get-Item ".\\$backupFile" | Select-Object Name, Length
}
finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $secure.Dispose()
}
```

The filename uses the current local date. The connection string exists briefly in the current PowerShell process environment during the dump. Use a trusted computer and an approved secret-management method if your environment has one.

Store the dump securely with restricted access. It may contain sensitive patient and appointment information. Do not upload it to GitHub. Confirm that the file exists and has a plausible non-zero size, but remember that only a restore test can establish that the dump is usable.

If `pg_dump` is not recognized, install PostgreSQL client tools matching a compatible PostgreSQL version, then open a new PowerShell window. Do not run the backup command against a test database by accident.

## 3. Test restoration into a separate, empty database

Restore to a **new or specifically designated recovery database**, never directly over production for a routine test. Obtain its connection string directly from the database provider. The secure prompt hides typing, but the value still exists briefly in the current process environment while restoring.

```powershell
$secure = Read-Host "Dedicated restore-database connection string (hidden input)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:RESTORE_DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $backupFile = Read-Host "Path to the verified dump file (for example .\\medical-booking-2026-10-16.dump)"
  pg_restore --no-owner --no-privileges --dbname="$env:RESTORE_DATABASE_URL" "$backupFile"
  if ($LASTEXITCODE -ne 0) { throw "pg_restore reported an error; inspect it before using this recovery database." }
}
finally {
  Remove-Item Env:RESTORE_DATABASE_URL -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $secure.Dispose()
}
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
