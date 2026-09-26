# MedCity — ROP Screening

AI-assisted screening for **Retinopathy of Prematurity**. A doctor registers
patients, uploads five retinal images per eye, and gets a per-eye **estimated
ROP risk**, stored as a reviewable record that the doctor signs off on.

## Architecture

Three layers. The frontend knows exactly one address — the gateway — and the
gateway is the only thing that can reach inference.

```
React (:3000)  ──HTTP──▶  NestJS gateway (:4000)  ──internal──▶  FastAPI (:8000)
   interface                auth · rules · database                model
```

| Layer | Responsibility | State |
| --- | --- | --- |
| Frontend (React + Vite) | Forms, image upload, rendering results. No medical logic. | Working |
| Gateway (NestJS + TypeORM) | Identity, ownership, validation, database, uploads. Sole caller of the ML service. | Working |
| PostgreSQL | Patients, screenings, results, access grants, activity log. | Docker (`docker-compose.yml`) |
| Object storage (MinIO / S3) | Retinal photographs, evidence renders, measurement packets. | Docker (`docker-compose.yml`) |
| Redis + BullMQ | The background job queue: severity analyses, nightly cleanup. | Docker (`docker-compose.yml`) |
| ML service (FastAPI) | Loads the model, runs inference. | Working — see [backend/fastapi/README.md](backend/fastapi/README.md) |

The gateway calls the ML service at `ML_SERVICE_URL`. There is no fallback: with
that variable unset a screening is refused rather than answered. In development
the gateway starts the service itself and stops it on exit — set
`ML_SERVICE_AUTOSTART=false` to run the two separately, which is what a
deployment does.

## Running it

Requires [Bun](https://bun.sh) and [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
# once: copy the settings and fill in the passwords (see the comments inside)
cp .env.example .env
cp backend/nest/.env.example backend/nest/.env

# the database, the object storage, the job queue and pgAdmin
docker compose up -d
docker compose ps            # postgres, minio and redis should say (healthy)
```

| What | Where |
| --- | --- |
| pgAdmin (look inside the database) | <http://localhost:5050> — password: `POSTGRES_PASSWORD` in `.env` |
| MinIO console (look at the stored files) | <http://localhost:9001> — `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` in `.env` |

The gateway starts the ML service for you (`ML_SERVICE_AUTOSTART=true`), so one
terminal is enough. Install the Python dependencies once first — see
[backend/fastapi/README.md](backend/fastapi/README.md) for those and the weights.

```bash
# gateway — starts the ML service alongside it
cd backend/nest
# generate a signing key and paste it into JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
bun install
bun run start:dev            # http://localhost:4000/api

# frontend, in a second terminal
cd ../..
bun install
bun run dev                  # http://localhost:3000
```

Register an account and you start with six demo patients and eight screenings,
owned by you. The demo timeline is shifted forward to the day you register, so
the demo babies are always young enough for the model to score. The gateway refuses to boot if `JWT_SECRET` is missing or under
32 characters, so it can never fall back to a default key.

Live API docs: <http://localhost:4000/api/docs>.

## Database

`DATABASE_URL` accepts three forms, all handled by the same driver setup:

| Value | Behaviour |
| --- | --- |
| `postgres://user:pass@host:5432/db` | The PostgreSQL server from `docker-compose.yml`. **Default.** |
| `pglite://./data` | Embedded Postgres persisted to `./data`. Quick tests only. |
| `pglite` | Embedded Postgres in memory. Wiped on every restart. |

Foreign keys tie every patient, screening and grant to its owner, and every
screening to its patient; all are `RESTRICT`, so deleting goes through the
services, which remove the files first. `npm run db:backup` writes a full dump
to `backend/nest/backups/` (ignored by git).

## File storage

Photographs are never kept on the gateway's disk and the database never holds a
path. Each file is an object in a private bucket, and the record holds its
**key**:

| Key | What |
| --- | --- |
| `detections/<uuid>.jpg` | a photograph the doctor uploaded |
| `severity/<job>-<name>.jpg` | an evidence image the severity analysis rendered |
| `evidence/<screening id>.json` | the per-photograph measurement packets |

The bucket speaks the Amazon S3 API. Locally it is the MinIO container; in
production, point `STORAGE_ENDPOINT` and the keys at Amazon S3 or any
S3-compatible store and nothing else changes. The browser never reaches the
bucket: `GET /api/files/<key>` streams a file after checking the bearer token
and the doctor's access grant.

Moving an older install from the `uploads/` folder: `bun run
storage:copy-from-disk` in `backend/nest` (copies, verifies, deletes nothing).

## Background jobs

A severity analysis takes about seventy seconds, far too long to hold a
request open. It goes on a **queue** in Redis instead, managed by BullMQ (the
Node.js counterpart of Python's Celery), and a **worker** in the gateway takes
jobs off it one at a time — one, because the models share one GPU.

```
POST /detections/:id/severity ──▶ Redis queue ──▶ worker ──▶ FastAPI Phase 2
        answers at once              waits          follows it, then writes the
        with a job id                               result to Postgres + storage
```

- **Durable.** The job lives in Redis, not in a process's memory. If the
  gateway restarts, the job is picked up again; if the analyser restarts or
  cannot be reached, the job is retried — four tries in all, 30 s, 60 s and
  120 s apart, time enough for the analyser to reload its models. If the analyser *refuses the photographs*, it fails at once with the
  reason: trying the same photographs again would get the same answer.
- **The worker is the only code that talks to the analyser.** It writes the
  result the moment the analysis ends. Routes only read — the frontend polls
  as before and sees no difference.
- **Scheduled work** uses the same queue: every night at 03:00 (`CLEANUP_CRON`)
  a job removes what abandoned previews left behind — staged photographs,
  unsaved results, unused renders and their grants. It never touches anything
  a saved screening uses.

`GET /api/health` answers 200 only when the database, the storage and the
queue all respond, and 503 naming the one that does not.

The schema is owned by migrations, not by the entity classes — `synchronize` is
off. Pending migrations run at boot, so a fresh clone comes up correctly.
After changing an entity:

```bash
cd backend/nest
bun run migration:generate src/database/migrations/DescribeYourChange
bun run migration:run
```

## Where the verdict comes from

The model reads a bag of **exactly five photographs of one eye**, together with
the patient's gestational age and their age in weeks at the examination, and
returns one calibrated probability. Both clinical numbers are read from the
patient record; a gestational age outside 20–45 weeks, or a baby more than 60
weeks old at the examination, stops the screening with an explanation rather than
being guessed at or extrapolated — screening happens in the first weeks of life,
and the training data averaged 7 weeks. Two eyes are two separate calls and two separate results —
they are never averaged.

A screening is scored **twice**, both times on the gateway:

1. `POST /api/detections/analyze` — images held in memory, scored, discarded.
   The doctor sees the estimate before committing anything.
2. `POST /api/detections` — images stored, scored again, and the record written
   from **that** result.

`CreateDetectionDto` has no `risk` or `result` field, and the validation pipe
runs with `whitelist: true`, so there is no request the browser can make that
sets a diagnosis. When both eyes are screened, the record is headlined by the eye
at **higher risk** — a healthy left eye must never mask a sick right eye in a list.

The model answers the binary question only, so it produces `ROP Detected` or
`No ROP Detected`, never a stage. Staging is phase 2. What the doctor concludes
is recorded separately as `doctorDecision`, and that field — not the model's
output — is the validation set for the next version of the model.

## Authentication

Local email + password, bcrypt-hashed, issuing a JWT. No SSO code exists here:
central SSO is being built by the platform team and will be integrated later.

Every record carries an `ownerId`. Each doctor's records are theirs alone —
every query is scoped by owner, and a request for another doctor's record
returns `404`, not `403`, so it does not reveal that the record exists.

## API

Everything under `/api`. All routes except `/health`, `/auth/register` and
`/auth/login` require `Authorization: Bearer <token>`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness probe |
| `POST` | `/auth/register` | Create an account |
| `POST` | `/auth/login` | Exchange credentials for a token |
| `GET` | `/auth/me` | Current doctor |
| `GET` `POST` | `/patients` | List / create |
| `GET` `PUT` `DELETE` | `/patients/:id` | Deleting cascades to that patient's screenings and image files |
| `GET` | `/detections` | Your screenings — `?patientId=` to filter |
| `POST` | `/detections/analyze` | Score images without saving (multipart) |
| `POST` | `/detections` | Store a screening; the gateway scores it (multipart) |
| `GET` `PUT` `DELETE` | `/detections/:id` | Deleting removes the stored images too |

## Layout

```
src/                      frontend
├── pages/                file-based routes (vite-plugin-pages)
│   ├── index.tsx         landing
│   ├── auth.tsx          sign in / register
│   └── app/              the product, behind the auth guard
├── components/
│   ├── app/              shared app UI + dashboard, detection and patient pieces
│   └── landing/          marketing sections
├── hooks/                auth context and provider
└── lib/                  api client, domain types, formatting

backend/
├── nest/src/             the gateway
│   ├── auth/             JWT strategy, guard, @CurrentUser
│   ├── users/
│   ├── patients/
│   ├── detections/       entity, DTOs, ROP vocabulary, uploads
│   ├── ml/               the only caller of the ML service
│   └── common/
└── fastapi/              reserved — see its README
```

## Tests

```bash
cd backend/nest
bun run test        # 20 unit tests — ROP severity rules, ID generation, ML client
bun run test:e2e    # 22 end-to-end tests — per-doctor isolation, server-side scoring
```

## Known gaps

- **The model cannot stage.** It answers "ROP or not"; severity is phase 2.
- **Exactly five images per eye**, for now — the bag size the model was trained
  with. Fewer would make it work from generated copies.
- **Images are uploaded twice** per screening — once to preview, once to save.
  The cost of keeping the preview step without ever trusting the client. With the
  real model that is roughly a second per eye, twice.
- **Not validated for clinical use.** 52 positive patients, one hospital, one
  camera, one grader. At the operating point in use the model misses roughly one
  sick eye in twenty and flags about half the eyes screened.
- **`public/` ships ~47 MB of video** on the landing page. Needs transcoding.
- **No frontend tests.**
