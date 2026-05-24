# BA Advisory Desk Storage And Upgrade Guide

Last updated: May 24, 2026

## Source Of Record And Retention Position

BA Advisory Desk uses Supabase as the source of record for client, project, request, message, file, payment, credit, notification, audit, and deliverable data.

Permanent retention expectations:

- Client workspace records should remain in Supabase tables unless a deliberate, approved data-retention workflow archives or exports them.
- Uploaded client source files should remain in the private `client-files` bucket after they are finalized into `request_files` or `client_uploads` records.
- Released deliverables should remain in the private `private-deliverables` bucket and in the version tables so prior versions stay recoverable.
- Workspace "delete" actions should be soft delete / removal-from-view actions only. They should set metadata such as `deleted_at`, `deleted_by`, and `deleted_reason`, and should not remove finalized storage objects.
- Draft/aborted uploads that were never finalized into a database record may be physically removed during cleanup, because they are not yet part of the client source of record.

Important implementation guardrails:

- Do not add client-facing hard-delete operations for organizations, projects, requests, finalized files, messages, or deliverables.
- Avoid `on delete cascade` for permanent client artifacts unless the application has a separate archive/export process and a very explicit destructive admin workflow.
- Any future deletion or retention workflow must record an `audit_events` row and should preserve storage objects unless legal/compliance deletion is explicitly required.
- Source file records in `request_files` and `client_uploads` are not the bytes themselves; the database row plus Supabase Storage object together form the retained artifact.

## Current File Storage Design

BA Advisory Desk uses Supabase for private client file storage and database records.

## Where Files Are Saved

### Client source files

These are files uploaded when a client submits a new request.

Storage bucket:

`client-files`

Database table:

`request_files`

Current path pattern:

`{user_id}/{request_id}/{timestamp}-{file_name}`

Used for:

- Original request files
- Notes
- Draft documents
- Transcripts
- Images
- PowerPoint, Word, Excel, and PDF source material

### Client revision and supporting uploads

These are files uploaded later from the client workspace.

Storage bucket:

`client-files`

Database table:

`client_uploads`

Current path pattern:

`{user_id}/workspace-uploads/{context_type}-{context_id}/{timestamp}-{file_name}`

Used for:

- Revision notes
- Source document additions
- Approval evidence
- Supporting files

### Admin deliverables

These are final or revised files released by the BA Advisory Desk team.

Storage bucket:

`private-deliverables`

Database tables:

- `deliverables`
- `deliverable_versions`
- `deliverable_version_files`

Current path pattern:

`clients/{organization_id}/deliverables/{deliverable_id}/v{version_number}/{timestamp}-{file_name}`

Used for:

- Requirements packages
- Business cases
- Board presentations
- SOP packs
- UAT packs
- AI assessment and governance documents
- Any other client-ready advisory deliverable

## Versioning Rules

Admin deliverables already support versioning.

When the admin uploads files for an existing deliverable:

1. A new version number is created.
2. All files uploaded together are grouped under that version.
3. The current deliverable points to the latest version.
4. Older versions remain available in the version history.

Client source files are not versioned yet. A revised source file is currently treated as a new upload. The recommended future enhancement is a controlled source file version model with:

- Original file
- Replacement file
- Version number
- Superseded file reference
- Status
- Retention date

## Current Free Plan Fit

The free Supabase plan is acceptable for build, configuration, and controlled pilot testing.

It is not the right long-term plan for real client delivery once paying clients begin uploading confidential project files.

Official Supabase limits checked on May 19, 2026:

- Free plan file upload limit: 50 MB per file.
- Free plan storage quota: 1 GB file storage.
- Free plan database quota: 500 MB database size. Projects can enter read-only mode above this database quota.
- Free plan monthly active users: 50,000 monthly active users.
- Free plan egress quota: official billing docs list 5 GB egress, while storage bandwidth docs describe 10 GB storage bandwidth as 5 GB cached plus 5 GB uncached. Treat this as a monitored limit before production.

Official references:

- Supabase billing docs: https://supabase.com/docs/guides/platform/billing-on-supabase
- Supabase storage file limits: https://supabase.com/docs/guides/storage/uploads/file-limits
- Supabase database size docs: https://supabase.com/docs/guides/platform/database-size
- Supabase pricing page: https://supabase.com/pricing

## Practical Capacity Estimate

The main constraint for BA Advisory Desk is file storage, not user accounts.

The database rows are small. The uploaded documents are the real capacity driver.

Example:

- If one client uploads 10 files averaging 10 MB each, that is about 100 MB.
- If the admin releases 5 deliverable files averaging 8 MB each, that is about 40 MB.
- One active client could therefore use 100 MB to 200 MB quickly.
- A 1 GB free storage quota may only support a small number of active client workspaces with realistic files.

## When To Upgrade

Upgrade Supabase before public paid launch if any of the following are true:

- More than 2 to 3 real paying clients will upload files.
- Any client is expected to upload more than 100 MB total.
- Any single file may exceed 50 MB.
- You need stronger operational confidence for client-facing delivery.
- You want no risk of the project becoming read-only because of database growth.
- You need higher storage, higher egress, better support, or production-grade operating comfort.

## Recommended Go-Live Position

Use the free plan for:

- Development
- Internal testing
- Demo accounts
- Stripe checkout testing
- Controlled end-to-end testing with the test Gmail account

Move to Supabase Pro before:

- Accepting real client uploads
- Taking more than one small pilot client
- Running paid traffic to the site
- Inviting clients to upload confidential operational material

## Remaining Storage Hardening Items

- Add a unified file browser that shows request files, client uploads, and released deliverables together.
- Validate the signed download route for client source files and revision uploads with live client and admin accounts.
- Move deliverable release into a server-side transaction.
- Add checksum tracking for uploaded files.
- Add file retention and deletion logs.
- Add archive and export workflow per client.
- Add a storage usage monitor so the admin can see storage by client.
