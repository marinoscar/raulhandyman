# Raul Handyman Admin

The admin app behind https://raulhandyman.net. A content editor adds a **project** (a description plus before/after photos); the app processes the photos, drafts the text with AI, enforces SEO rules, and on **Publish** makes the project available to the public site's build. It is an app built on the platform packages, started from the EnterpriseAppBase starter.

[![CI](https://github.com/marinoscar/raulhandyman/actions/workflows/admin-ci.yml/badge.svg)](https://github.com/marinoscar/raulhandyman/actions/workflows/admin-ci.yml)

The platform (sign-in, users and organizations, settings, the job queue, the admin Doctor, the CLI, the Compose and nginx stack) comes from the published `@marinoscar/platform-*` packages. This repository holds only what is yours: the composition (`apps/api/src/platform/`, `apps/web/src/App.tsx`, `apps/cli/src/app.ts`), your domain code, and your appearance.

**Never edit platform code here.** There is none to edit: it lives in `node_modules`. When the platform lacks a seam you need, ask for it upstream with a [seam request](https://github.com/marinoscar/EnterpriseAppBase/issues/new?template=seam_request.yml); see [Changing the platform](#changing-the-platform).

Operating it on the VPS: [../docs/runbook-admin.md](../docs/runbook-admin.md). The public site and how it consumes this app: [../README.md](../README.md#projects).

## What the admin does

| Area | Code | What it does |
|---|---|---|
| Projects | `apps/api/src/projects/` (web: `apps/web/src/projects/`, pages `ProjectsPage`, `ProjectEditorPage`) | CRUD for projects and photos, SEO lint, publish and unpublish |
| Photo pipeline | `projects/media/` | Validates an upload, grades it (sharp), writes crops and a branded Open Graph image |
| AI | `projects/ai/`, `src/platform/ai/` | Suggests title, description and alt text from the photos; optional photo retouch |
| Site content API | `apps/api/src/site/` | What the site build reads, build-status reports, IndexNow pings |

Photos: JPEG, PNG and WebP are accepted (the file's magic bytes are checked, not its name). **HEIC is rejected** with a message that tells the editor to switch the iPhone camera to Most Compatible or share as JPEG. The project goal is that no EXIF or GPS data reaches a public image; the renditions are produced by sharp from the master, and a test for that on real uploads was not part of this documentation task.

## Roles and permissions

Declared in `apps/api/src/projects/projects.permissions.ts`; the strings below are exactly what the controllers enforce.

| Permission | Enforced by | `org_admin` | `content_editor` | `site_reader` |
|---|---|---|---|---|
| `projects:read` | list, read, catalog, `GET /api/site/status` | yes | yes | no |
| `projects:write` | create/edit/delete projects and photos, apply an AI suggestion, discard a retouch | yes | yes | no |
| `projects:publish` | publish, unpublish, the IndexNow key routes | yes | yes | no |
| `site_content:read` | `GET /api/site/content`, `/content/version`, `/media/...`, `POST /api/site/build-status` | yes | no | yes |
| `ai:use` (platform) | AI suggest, regenerate, retouch (with `projects:write`) | per the platform's sets | granted to the role | no |
| `storage:read`, `storage:write` (platform) | uploads | per the platform's sets | granted to the role | no |

- `content_editor` is the business owner's role. It holds none of the administration permissions (users, storage config, AI keys, backups, system settings).
- `site_reader` is the **service role of the site build**. A personal access token cannot be narrowed to one permission: it authenticates as its owner with that owner's permissions, bound to one organization. So the build token is created by a dedicated service user who holds only `site_reader`. Never mint it from an administrator or editor account. Steps: [runbook](../docs/runbook-admin.md#6-create-the-build-token).
- The owner (`INITIAL_ADMIN_EMAIL`) is always allowed in and is the administrator.

## Slices used and why

`packages/shared/slices.json` enables nine optional slices.

| Slice | Why this app needs it |
|---|---|
| `credentials` | Encrypts the storage, OpenAI, Web Push and IndexNow secrets (`SECRETS_ENCRYPTION_KEY`) |
| `storage` | Keeps originals and every rendition (prefix `project-media/<orgId>/<projectId>/<photoId>/`) |
| `email` | SMTP or SES transport for the `site.build_failed` email |
| `notifications` | In-app inbox, preferences, Web Push for editors on a phone |
| `ai` | OpenAI gateway: keys, models, usage and cost per feature |
| `db-backup` | Scheduled `pg_dump` of the portfolio to object storage |
| `exports` | The projects export (below) |
| `onboarding` | The administrator's Setup guide and the editor's Get started |
| `telemetry` | Metrics, Doctor checks and the explorer (optional at runtime) |

`sharing` and `android-app` are not enabled. The rest of this file (from [Layout](#layout)) is the starter's reference for the app's structure and for the optional slices table.

## Run it from zero (local development)

Needs Node 24 and Docker. The commands are the starter's; see [Run it](#run-it).

1. `npm install`, then `npm run setup` (writes `infra/compose/.env`).
2. Put `INITIAL_ADMIN_EMAIL`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `infra/compose/.env`. For local sign-in the Google client needs the redirect URI `http://localhost:3535/api/auth/google/callback`.
3. `docker network create devnet` (once), then the `docker compose ... up` and the `prisma:migrate` and `prisma:seed` commands from [Run it](#run-it). The seed creates the permissions and the two roles.
4. Open http://localhost:3535 and sign in. Configure storage at `/admin/settings/storage` (a local S3-compatible bucket works) before uploading photos.
5. To exercise the site against it: build the site from the repo root with `CONTENT_API_URL=http://127.0.0.1:<port> CONTENT_API_TOKEN_FILE=<file> npm run build:prod` ([root README](../README.md#local-build-fixtures-or-the-live-api)). The token comes from a `site_reader` service user.

CI for this app is `.github/workflows/admin-ci.yml` (repository root): `platform:check`, typecheck, `npm test` (includes `runPlatformConformance`), build, then the database tier against a migrated, seeded PostgreSQL with an ordinary application role.

## Where each runtime setting lives

Everything below is configured in the admin UI, **never** in `.env` (a second source of truth is the failure this prevents). The only deployment values are in `infra/compose/.env`: the secrets and the bind port.

| Setting | Where | Permission |
|---|---|---|
| Storage provider, bucket, upload limits (`allowedMimeTypes`, `maxFileSize`) | `/admin/settings/storage` | `storage_config:*` |
| AI on/off, OpenAI key, enabled models | `/admin/settings/ai` | `ai_config:*` |
| Web Push (VAPID key pair) | `/admin/settings/push` | `push:*` |
| SMTP or SES | `/admin/settings/email` | via the email slice |
| Telemetry connection | `/admin/settings/telemetry` | via the telemetry slice |
| Database backup policy | `/admin/settings/db-backup` | `db_backup:*` |
| Brand colours, business name, phone, logo, photo grade, branded OG on/off | system settings namespace `projects` (`GET/PATCH /api/system-settings`) | `system_settings:write` |
| IndexNow key | API `/api/site/indexnow/key` | `projects:publish` |
| Site publishing state and the build token | `/admin/settings/site-publishing` (the path the Doctor checks and the Setup guide link to) | `projects:publish` |

Deployment values: `INITIAL_ADMIN_EMAIL`, the Google client, `SECRETS_ENCRYPTION_KEY`, `APP_BIND_PORT`. The site's deploy script expects the admin API on port **8340** by default (override with `ADMIN_API_URL` in `deploy/deploy.sh`), so the production `.env` sets `APP_BIND_PORT=8340`.

The `projects` settings namespace (`apps/api/src/projects/projects.settings.ts`) holds `brand` (`navy`, `gold`, `businessName`, `phoneDisplay`, `logoObjectId`), `grade` (`warmth` 0-0.3, `saturation` 0.5-1.5) and `og.enabled`. A change applies to the next processed photo.

## Job types

All long work is a queue job (a job type string is permanent once jobs of it exist). AI jobs are server-only.

| Type | Does | Notes |
|---|---|---|
| `projects.photo.process` | Enhance, crops, branded OG image for one uploaded photo | sharp; result notification `projects.photo_ready` |
| `projects.ai.suggest` | One AI copy suggestion per project | one active job per project |
| `projects.photo.retouch` | One AI retouch of one photo | never for a `before` photo; the original is always kept |
| `projects.site.ping` | Tells IndexNow which URLs changed after a build went live | only `api.indexnow.org` over https; enqueued by `POST /api/site/build-status` with `live` |

## AI

| Feature id | Label | Needs |
|---|---|---|
| `projects_copy` | Project copy and alt text | a model with `responses`, `structured_output` and image input |
| `projects_retouch` | Photo retouch | a model with `image_edit` |

Usage and cost appear per feature at Admin, AI, Usage. Retouch of a `before` photo is refused with HTTP 422 `RETOUCH_NOT_ALLOWED`; the editor approves every retouch result. The branded Open Graph image of a cover always uses the standard crop: it is not rebuilt from a retouched variant.

## Notification events

Registered in `apps/api/src/projects/projects.notifications.ts`, raised after the write commits. A key is persisted in preferences: never rename one.

| Key | Sent to | Channels |
|---|---|---|
| `projects.photo_ready` | the uploader, when processing finishes or fails | browser |
| `projects.ai_ready` | who asked for the AI draft | browser, push |
| `projects.retouch_ready` | who asked for the retouch | browser, push |
| `projects.published` | everyone who can publish, when someone else publishes | browser |
| `site.build_live` | who published the newest change | browser, push |
| `site.build_failed` | the organization administrators | email, browser, push |

## Metrics

Declared in `apps/api/src/projects/events/projects.metrics.ts`; labels are low cardinality only (stage, result, action, status).

| Metric name | Kind | Labels |
|---|---|---|
| `app.projects_photo_process_ms` | histogram | `stage` (enhance, crops, og), `result` |
| `app.projects_ai_suggest_ms` | histogram | `result` |
| `app.projects_ai_retouch` | counter | `result` |
| `app.projects_published` | counter | `action` (publish, unpublish) |
| `app.site_build_duration_ms` | histogram | `status` (live, failed) |
| `app.site_build_failures` | counter | none |
| `app.site_content_staleness` | gauge (seconds) | none |

They are grouped for the Telemetry explorer by `PROJECTS_METRIC_GROUP`. The exact GreptimeDB table names follow the platform's table rule (dots become `_`, a counter gains `_total`, a histogram `_bucket`) but were **not verified against a live store**.

## Doctor checks

Category `projects`, run at `/admin/settings/doctor` (read-only). Triage steps per check: [runbook, troubleshooting](../docs/runbook-admin.md#14-troubleshooting).

| Check id | Fails or warns when |
|---|---|
| `site.content_token` | no build token, all expired, never used or idle over a day (fail); idle over 10 minutes or expiring soon (warn) |
| `site.build_freshness` | the last build failed, or the site is more than 15 minutes behind the published content (fail); 5-15 minutes (warn) |
| `projects.media_integrity` | a published photo is missing a rendition |
| `ai.projects_ready` | AI is off or no model can draft copy (fail); no image-edit model (warn) |
| `site.indexnow` | no key (warn); the last ping was refused (fail); a retry is pending (warn) |

## Data export

Source `projects` (writer `projects-zip`, `apps/api/src/platform/exports/projects.export-source.ts`): `projects.json` with every project of every status (work notes included, the AI suggestion never) and `photos/<slug>/...` with each photo's original and chosen master, streamed one file at a time. Signed download and expiry are the platform's.

## What was not verified

Written and tested without these, so check them on first real use: a Docker or VPS deploy of the admin, real OpenAI calls, a real storage provider, the GreptimeDB metric table names, and the Lighthouse gate on CI runners. The `/admin/settings/site-publishing` card is referenced by the API, the Doctor and the Setup guide; confirm it is present in your build of the web app (it was not found under `apps/web/src` when this document was written).

## Layout

```
apps/api/          NestJS API: src/platform/ binds the packages (slices/ + one folder per optional slice), src/notes/ is the sample feature
  prisma/          fragments/ (your models), schema/ (GENERATED), migrations/, platform.lock, seed.ts
apps/web/          React app: App.tsx (routes, the packaged shell), slices/ (one file per optional slice), config/ (the two settings registries, the navigation), theme.ts, pages/
apps/cli/          the CLI: createCli() with this app's identity
packages/shared/   identity.json: the ONE identity source (name, repository, CLI name, colours); slices.json: the ONE slice manifest
infra/             platform fragments GENERATED by platform-infra sync, plus your app.* overlays
scripts/rename.mjs rebrand this app (identity.json plus the few literal targets)
```

## Run it

Needs Node 24 and Docker.

```bash
git clone https://github.com/marinoscar/raulhandyman.git
cd raulhandyman
npm install
npm run setup                    # builds the CLI and writes infra/compose/.env
docker network create devnet     # once per host
cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml up
```

Then, with the same `-f` files, migrate and seed (the API never migrates on startup):

```bash
docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml exec api npm run prisma:migrate
docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml exec api npm run prisma:seed
```

Three values nothing can generate go in `infra/compose/.env`: `INITIAL_ADMIN_EMAIL` (your Google account; it is always allowed in and becomes the administrator), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The application is at http://localhost:3535.

Checks, as CI runs them (`.github/workflows/ci.yml`):

```bash
npm run platform:check     # installed migrations, composed schema and infra fragments equal the packages'
npm run typecheck
npm test                   # API (with runPlatformConformance), web and CLI
npm run build
npm run test:db --workspace=api   # the whole app against a migrated, seeded PostgreSQL
```

## Add your first feature

`apps/api/src/notes/` is a complete feature in seven small files. Copy its shape; each step below names the package documentation it follows.

1. **A model.** Write it in `apps/api/prisma/fragments/<feature>.prisma`, with an `extend model User { ... }` block for the back-relation, then:

   ```bash
   cd apps/api
   npm run db:compose                                    # platform fragments + yours -> prisma/schema/
   npm run prisma:generate
   npm run prisma:migrate:dev -- --name add_<feature>    # your migration sorts after the installed ones
   ```

   A model with a foreign key to `User` is registered in the user-owned data registry with its purge and export policy, and classified in the model ownership registry (`notes.ownership.ts`, registered after the platform's own models by `src/platform/registrations.ts`); the conformance suite, which checks the whole composed schema, fails until it is. Catalog: [`platform-db` extension points](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-db/README.md#extension-point-catalog), [scoped data access](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/core/README.md#extension-point-catalog).
2. **A permission.** Declare it as data (`notes.permissions.ts`), add the map to `app.permissions` in `src/platform/permissions.ts` (the registry and the seed both read it, after the platform's), and put `@Auth({ permissions: [...] })` on every route: there is no global guard, so a route without `@Auth()` is public. Validate every body with zod (`notes.schemas.ts`). Catalog: [identity](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/identity/README.md#extension-point-catalog).
3. **A settings namespace and its card.** Register the namespace before `SettingsModule.forRoot()` (`notes.settings.ts`); append its card to `apps/web/src/config/adminSections.tsx` or `userSettingsSections.tsx` with the exact permission string its route enforces. Never add a settings page as a tab of another. Catalog: [settings (API)](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/settings/README.md#extension-point-catalog), [settings (web)](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-web/src/settings/README.md#extension-point-catalog).
4. **A job.** Anything that outlives a request is a registered job handler (`notes-archive.job.ts`); a `@Cron` only decides whether work is due and enqueues it. A job `type` is permanent once jobs of it exist. Catalog: [jobs](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/jobs/README.md#extension-point-catalog).
5. **A Doctor check.** One read-only provider that registers itself (`notes.doctor-check.ts`); it appears at `/admin/settings/doctor`. Catalog: [doctor](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/doctor/README.md#extension-point-catalog).

Then add the module to `apps/api/src/app.module.ts`, its page to `apps/web/src/App.tsx`, and tests beside the notes ones.

## Optional slices

The core is always mounted: the API host (the event bus, the platform's app metrics, maintenance mode at `/api/admin/maintenance`, the `{ data }` envelope, request ids, the API reference at `/api/docs`: [host](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/host/README.md)), identity, settings, worker-node credentials, jobs, the Doctor and the data resets (the user Danger Zone at `/settings/danger-zone`, the admin factory reset and organization offboarding: [user-data](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/user-data/README.md)). Everything else the platform ships is an **optional slice**, and **which slices this app mounts is one list**: `enabled` in [`packages/shared/slices.json`](packages/shared/slices.json). The API and the web app both read it, so they cannot disagree.

| Slice | What you get | Requires | Notes |
|---|---|---|---|
| `credentials` | The encrypted credential store (deployment, user and organization tiers) | none | No pages. Needs `SECRETS_ENCRYPTION_KEY`. [README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/credentials/README.md) |
| `storage` | Uploads (`/api/storage`), profile pictures (Profile page), the storage admin page | `credentials` | Bucket, region and key are set at `/admin/settings/storage`, never in `.env`. [README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/storage/README.md) |
| `email` | SES and SMTP transports, templates, the email settings page | `credentials` | Set at `/admin/settings/email`. [README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/email/README.md) |
| `notifications` | The bell and live inbox, preferences, email delivery, **Web Push**, admin broadcasts; the identity notices stop being log lines | `email` | Web Push: an administrator generates a VAPID key pair at `/admin/settings/push`; the service worker is `apps/web/src/sw.ts`, served at `/sw.js`. [README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/notifications/README.md) |
| `sharing` | Groups, members, invites, grants, link shares and the public `/s` page, and a sample shareable record (`/api/documents`) | `notifications` | A shareable record belongs to an organization, so the sample is a `Document`, not the personal `Note`; the README has the other shapes. [README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/sharing/README.md) |
| `ai` | The provider gateway (keys at three tiers, models, usage) and its admin and key pages | `credentials`, `storage` | Off until an administrator enables it at `/admin/settings/ai`. Server-side only. [README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/ai/README.md) |
| `db-backup` | Scheduled and on-demand `pg_dump` to object storage, retention, a guarded restore | `storage`, `notifications` | Needs a direct database connection (no transaction-mode pooler); the API image carries the pinned client. [README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/db-backup/README.md) |
| `exports` | Signed, expiring exports of a user's or an organization's data | `storage`, `notifications` | The sample feature's notes source is the example. [README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/exports/README.md) |
| `onboarding` | The welcome dialog, Get started, the administrator's Setup guide, activation metrics | none | A step shows only when the page it links to exists in the enabled slices. [README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/onboarding/README.md) |
| `android-app` | Trusted-app asset links, hosted APK releases, the Android push channel | `storage`, `notifications` | The server half; the Kotlin shell is built by the CLI's `android` command. [README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/android-app/README.md) |
| `telemetry` | The OpenTelemetry export gate, the GreptimeDB connection, the SQL Explorer (with an AI assistant when `ai` is on), the Telemetry Dashboard and its metric groups, the `telemetry.*` Doctor checks | `credentials` | Off until an administrator saves a connection and turns collection on at `/admin/settings/telemetry`; the SDK starts only with `OTEL_ENABLED=true`. [README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/telemetry/README.md) |

Not in the starter yet: the web conformance call (`runPlatformWebConformance`); `src/__tests__/slices.test.ts` covers the registries.

**Turn a slice off** by deleting its line from `enabled`. Order does not matter, and a slice that requires one you removed fails at startup naming both, with the line to add or remove. Nothing else changes: its routes answer 404, its cards, pages, providers, banners and jobs are not mounted, its permissions are not seeded, and its `forRoot()` never runs. Its tables stay in the schema (the platform's migrations are one history), unused.

**Turn a slice on** by adding its id, then:

```bash
cd apps/api && npm run prisma:seed       # seeds the permissions its routes check (upserts only)
```

and restart. Nothing else is required in code: the slice's runtime configuration (a bucket, an email transport, an AI key, a VAPID key pair) is set in the admin UI, never in `.env`.

**Remove a slice's code for good** (not just switch it off): delete `apps/api/src/platform/<id>/`, `apps/web/src/slices/<id>.tsx`, their lines in `apps/api/src/platform/slices/definitions.ts` and `apps/web/src/slices/definitions.ts`, and the slice's entry in `catalog` and `enabled` of `slices.json`.

**Peer dependencies.** The platform packages mark every peer their always-mounted core does not need as *optional*, and npm never installs an optional peer, so this app declares the peers of the slices it imports itself (`apps/api/package.json`, `apps/web/package.json`). The lists come from [`packages/platform-slice-peers.json`](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-slice-peers.json) in the platform repository, and `node scripts/check-slice-peers.mjs --app apps/api` (the platform repository's check, run in CI against this starter) fails when an imported slice's peer is not declared. On the API every optional slice above runs on the peers of the always-mounted core (`@nestjs/*`, `fastify`, `passport`, `@prisma/client-runtime-utils`, `@opentelemetry/api`, `zod` and friends), so removing an API slice removes no dependency. On the web, two slices bring peers of their own, which you may remove together with the slice's code:

| Slice | Web peers only it needs |
|---|---|
| `ai` | `@mui/x-data-grid` (its lists use the packaged data table) |
| `telemetry` | `@mui/x-charts`, `@mui/x-data-grid`, `@uiw/react-codemirror`, `@codemirror/lang-sql` |

The root `package.json` carries `overrides: { "fastify": "^5" }` because `@nestjs/platform-fastify` pins one exact `fastify` and the API declares the peer range: without it npm installs two copies and the Fastify plugin types stop matching.

`@mui/x-data-grid` stays while either slice, or any other page of yours that uses the packaged data table, remains.

**Where a slice lives.** On the API, `src/platform/<id>/` holds `<id>.slice.ts` (what the slice mounts, replaces and contributes: its modules, host-port overrides, registrations, notifications, storage prefixes, settings namespaces), its `forRoot()` configuration (`*.config.ts`), its host-port adapters and its **minimal example**; `src/platform/slices/` is the loader. A slice definition runs nothing on import: everything lazy sits behind a function that is called for an enabled slice only. On the web, `src/slices/<id>.tsx` is the slice's routes, cards, providers and shell parts; `src/slices/manifest.ts` composes the enabled ones into `App.tsx` and the two registries in `src/config/`.

| Slice | Minimal example |
|---|---|
| `credentials` | `credential-purposes.ts`: a purpose the sample feature could keep a webhook secret under |
| `storage` | `storage-prefixes.ts`: the key prefix of files attached to a note |
| `email` | `templates/notes-archived.email.ts`: an app template, typed through `EmailTemplateDataMap` |
| `notifications` | `notes-archived.notification.ts`: an event raised by the sample archive job after its write commits |
| `sharing` | `documents/`: the `document` resource type (`document.resource-type.ts`), its service deciding every record with `AccessPolicy` and its controller; the `Document` model is an organization's row with row-level security (`prisma/fragments/documents.prisma`) |
| `ai` | `notes-summary.feature.ts`: a registered feature and a service calling `AiService.forUser` |
| `db-backup` | `restore-carry-over.ts`: a table whose rows survive a restore |
| `exports` | `notes.export-source.ts`: a shaped, filterable export of the notes |
| `onboarding` | `onboarding.manifest.ts`: a fact and a "write your first note" step |
| `android-app` | `device-source.ts`: the device source a native capability replaces |
| `telemetry` | `activity.metric-group.ts`: a Telemetry Dashboard section of the app's own (sign-ins and token refreshes by outcome), one option of `TelemetryModule.forRoot` |

**Tests.** `test/slices.spec.ts` and `src/__tests__/slices.test.ts` check the manifest rules; `test/slices-composition.spec.ts` and the web twin compose the core alone and each slice with only what it requires, and prove it mounts, the others are absent, its permissions are seeded only while it is on and the host ports it replaces are replaced; `test/slices.db.spec.ts` probes one route per slice against a real database, 404 when off. `test/conformance.spec.ts` runs the enabled slices' conformance suites; `test/ai-conformance.spec.ts` runs the five AI suites that boot the app (kill switch, RBAC matrix, secret egress, key policy, jobs server-only) over a mocked database, with the fixture in `test/ai-conformance/` (no PostgreSQL needed). `test/documents.db.spec.ts` proves the sharing slice's sample record end to end under row-level security.

## Rename

```bash
node scripts/rename.mjs --name "Kappa Hub" --repo kappa/kappa-hub --theme "#c62828" [--cli-name kappactl] [--dry-run]
```

It writes `packages/shared/identity.json`, edits the literal targets nothing can derive (the root `package.json` name, this README, `install.sh`, the two SVG fills, the CI test database, the CLI `bin` key), and re-renders `infra/` with `platform-infra sync`. It never commits.

## Upgrading the platform

Renovate (`renovate.json`) opens one pull request that moves every `@marinoscar/platform-*` package to the same version. After merging it:

```bash
npm install
cd apps/api && npm run db:sync && npm run db:compose && npm run prisma:generate   # new platform migrations and fragments
cd ../.. && npm run platform:infra:sync                                           # new infra fragments
npm run platform:check
```

Order matters for migrations: `db:sync` installs the package's new migrations first, then `prisma migrate dev` authors yours after them. Read each package's `CHANGELOG.md` for upgrade notes.

**The `next` channel.** Pre-releases are published under the `next` dist-tag. To try one, install it explicitly (`npm install @marinoscar/platform-api@next ...`, every platform package at the same version), or set `"followTag": "next"` on the platform rule in `renovate.json`.

## Changing the platform

The platform's code is not in this repository, on purpose: an app that edits a copy drifts from every other app. When you need something the packages do not offer (a port, a registry, an option):

1. [File a seam request](https://github.com/marinoscar/EnterpriseAppBase/issues/new?template=seam_request.yml) in the platform repository: what you need, where, and why the existing extension points do not cover it.
2. Work around it in your own code, behind your own interface, until the release that adds the seam.

## License

[Your License Here]
