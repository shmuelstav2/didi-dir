# didi-dir — מערכת ניהול עדר כבשים

Sheep flock management system. Hebrew RTL web app: flock book, animal cards with a full
event history, lambing registration with automatic lamb creation, breeding-group planning
and a live dashboard.

Built to the approved "option-2" design concept - the design system in `public/css/base.css`
is that concept's stylesheet, reused verbatim.

## Stack

| Layer | Choice |
|---|---|
| Server | Node 22 + Express |
| Database | MongoDB (Cosmos DB for MongoDB vCore in Azure) |
| Auth | JWT in an httpOnly cookie, bcrypt password hashes |
| UI | Vanilla JS + HTML, no build step, RTL Hebrew |
| Hosting | Azure App Service (Linux, F1) |
| CI/CD | GitHub Actions - tests gate every deploy |

## Environments

| Env | URL | Branch | Azure app | Mongo DB |
|---|---|---|---|---|
| Production | https://didi-dir.azurewebsites.net | `main` | `didi-dir` | `didi_dir` |
| Non-prod | https://didi-dir-np.azurewebsites.net | `develop` | `didi-dir-np` | `didi_dir_np` |

Both apps live in resource group `DIDI` (westus3) on the `didi-plan` F1 plan, and share the
`bakar-hazan-mongo` Cosmos vCore cluster with separate databases.

Non-prod runs with `SEED_ON_START=1`, so it always has a demo flock.

## Local development

```bash
npm install
npm run dev          # in-memory MongoDB, no external services needed
```

Then open http://localhost:8080 and sign in with `admin` / the value of `ADMIN_PASSWORD`
(default `didi2026!`). To load a realistic demo flock:

```bash
SEED_ON_START=1 npm run dev
```

Environment variables are documented in `.env.example`. With `MONGO_URI` unset the server
starts an ephemeral in-process MongoDB, which is also what the tests use.

## Tests

```bash
npm test
```

15 end-to-end tests run the real Express app against a real (in-memory) MongoDB: auth,
role permissions, animal CRUD, event side effects (weighing → last weight, pregnancy check →
expected lambing date), lambing cascades, season aggregation and breeding-group maths.

## Data model

| Collection | Purpose |
|---|---|
| `users` | username, bcrypt hash, role (`admin` / `manager` / `viewer`) |
| `animals` | the flock book - one document per animal, keyed by `tag` |
| `events` | timeline per animal: weighing, pregnancy check, vaccination, mating, lambing |
| `lambings` | one document per lambing, with the offspring array |
| `breeding_groups` | mating groups, stage, expected lambing date |
| `treatments` | treatment / task calendar |

### Business rules encoded in the API

- Registering a lambing creates every living lamb in the flock book, links it to its dam and
  sire, writes a `lambing` event on the mother and sets her to `lactating`.
- A positive pregnancy check sets the expected lambing date to mating date + 150 days.
- A weighing event updates the animal's last weight and weighing date.
- Breeding groups default their expected lambing date to mating start + 150 days.
- The lambing season runs 1 Oct → 30 Sep; all season KPIs use that window.

## Roles

| Role | Can do |
|---|---|
| `admin` | everything, including user management |
| `manager` | all farm data, read and write |
| `viewer` | read only - every write returns 403 |

The first admin is created automatically on first start from `ADMIN_USER` / `ADMIN_PASSWORD`
when the users collection is empty, so a fresh deployment is never locked out.

## Deployment

Push to `develop` → tests run → deploys to non-prod → the workflow polls `/healthz` until it
reports `ok`, and fails the run if it never does. Push to `main` does the same for production.

Manual deploy from a laptop, if ever needed:

```bash
az webapp deploy -g DIDI -n didi-dir-np --src-path <zip> --type zip
```

## Health

`GET /healthz` pings MongoDB and returns `{status, env, db, mongoMs, uptimeSec}`; it returns
503 when the database is unreachable. `GET /api/version` reports the running version and env.
Both are unauthenticated by design and expose no flock data.
