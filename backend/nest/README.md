# MedCity ROP — NestJS Gateway

The protected middle layer. It authenticates the doctor, enforces record
ownership, owns the database, and is the **only** service permitted to call the
FastAPI ML layer.

Project overview and architecture diagram: [../../README.md](../../README.md).

## Run

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # paste into JWT_SECRET
bun install
bun run start:dev
```

- API — <http://localhost:4000/api>
- Docs — <http://localhost:4000/api/docs>

Boot fails fast if `JWT_SECRET` is missing or shorter than 32 characters
(`src/config/env.validation.ts`). That is deliberate: there is no default key to
silently fall back to.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `JWT_SECRET` | — | **Required.** ≥32 chars. |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime. |
| `DATABASE_URL` | `pglite://./data` | `pglite://<dir>`, `pglite` (memory), or a `postgres://` URL. |
| `PORT` | `4000` | |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated. No wildcard — requests carry credentials. |
| `ML_SERVICE_URL` | *(empty)* | Set once FastAPI exists; empty uses the local placeholder. |

## Modules

| Module | Responsibility |
| --- | --- |
| `auth` | Register / login / me. JWT strategy, `JwtAuthGuard`, `@CurrentUser()`. Seeds a new doctor's demo records. |
| `users` | Account persistence. |
| `patients` | Patient CRUD, owner-scoped. Deleting cascades to that patient's screenings. |
| `detections` | Screening CRUD, image upload, and the ROP vocabulary (`rop.ts`). |
| `ml` | The single point of contact with the ML layer. |
| `database` | Connection options shared by the app and the CLI, plus the migrations. |
| `common` | Shared id generation. |

## Schema and migrations

`synchronize` is **off**. The schema is defined by the migrations in
`src/database/migrations/`, and the app applies any pending ones at boot
(`migrationsRun: true`), so a fresh clone starts correctly with no manual step.

After changing an entity:

```bash
bun run migration:generate src/database/migrations/DescribeYourChange
bun run migration:show      # [X] applied, [ ] pending
bun run migration:run       # or restart the app
bun run migration:revert    # undo the last one
```

Stop the gateway first — PGlite locks its data directory and the CLI needs it.

`src/database/data-source-options.ts` is the single definition of the
connection, used by both Nest and the CLI. Keeping one copy is what stops
generated migrations from drifting away from the schema the app really uses.

## Two rules the code enforces

**Ownership.** Every entity carries `ownerId`; every query is scoped by it, and
`ownerId` is stamped from the token, never accepted from the request body.
Another doctor's record returns `404` rather than `403`, so its existence is not
disclosed.

**Verdict provenance.** `CreateDetectionDto` contains no `result`, `confidence`
or `eyeResults`. Combined with `whitelist: true` on the global `ValidationPipe`,
a client cannot submit a diagnosis — the gateway derives it from the stored
images via `MlService` and writes what the model returned.

## Conventions

- Controllers stay thin: validate, delegate, map to HTTP.
- Services never see HTTP. They take an `ownerId` and return domain objects or `null`.
- The ROP vocabulary lives in one place, `detections/rop.ts`. Add a stage there
  and the DTO validators, entity types and severity ordering follow.
- Files on disk are `detections/detection-storage.ts`'s concern; deletes go through it.

## Scripts

| | |
| --- | --- |
| `bun run start:dev` | Watch mode |
| `bun run build` | Compile to `dist/` |
| `bun run start:prod` | Run the build |
| `bun run lint` | ESLint, `--fix` |
| `bun run test` | Jest |
