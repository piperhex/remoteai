# Admin repositories

The management backend and UI are independent Git submodules:

| Parent path | Repository | Standalone checks |
| --- | --- | --- |
| `apps/admin` | https://github.com/piperhex/remoteai-admin | `npm run check`, deployment guard tests |
| `apps/admin-ui` | https://github.com/piperhex/remoteai-admin-ui | `npm ci && npm run check` |

The old NestJS backend is removed. The Go repository preserves frozen contract and validation fixtures,
and its extracted commit history. Its Go module is `github.com/piperhex/remoteai-admin`, with `cmd/admin`
as the executable entry point. The UI repository preserves its own extracted history.

## Local development

```sh
git submodule update --init apps/admin apps/admin-ui
npm ci --prefix apps/admin-ui
npm run dev:backend
npm run dev:admin
```

Copy `apps/admin/.env.example` to `apps/admin/.env` and configure development PostgreSQL and Redis first.
Open `http://127.0.0.1:1421/admin.html`. The UI development proxy targets backend port 8080.

Parent npm workspaces, normal checks, builds and desktop releases exclude both submodules. A plain clone
works without initializing them. Explicit `build:backend`, `check:backend`, `build:admin`, `check:admin`
and `deploy:admin` commands require the corresponding submodule.

## Shared source ownership

The parent still owns `shared/` and `packages/i18n`. The UI consumes generated npm dependency archives
through the public `@remoteai/shared` and `@remoteai/i18n` interfaces. `vendor/source-lock.json` records
the original repository, commit and individual source hashes; npm's lockfile pins archive integrity.
There are no separately maintained translation tables in the UI repository.

After editing a shared dependency, run `npm run generate:i18n`, `npm run check:i18n`, then
`npm run export:admin-ui`. In `apps/admin-ui`, run `npm install` and `npm run check`, review the artifacts,
and commit and push the child before updating the parent gitlink. Backend platform translation sources
and their generation manifest now belong to `apps/admin/packages/i18n`.

## Images and deployment

From the parent checkout:

```sh
docker build --target verify -f apps/admin/Dockerfile apps/admin
docker build --build-context admin-ui=apps/admin-ui -f apps/admin/Dockerfile -t remoteai-admin:local apps/admin
```

Compose defaults the UI build context to sibling `../admin-ui`; `ADMIN_UI_CONTEXT` can point to another
checkout. The backend includes the built UI in its runtime image, while ordinary UI builds write only
to `apps/admin-ui/dist`.

Production service names (`admin-go`), `ADMIN_GO_*` variables, aliases and existing image tags remain
compatible. Follow `apps/admin/DEPLOYMENT.md`; the directory move itself does not deploy anything.
Keep the server's existing deployment directory and full Compose file list intact when updating source.
Moving a deployed directory requires a separately planned migration of the recorded Compose paths;
do not bypass the deployment guard or discard the TURN Compose fragment.

## Updating the parent

Commit and push each child first, then commit its gitlink in this repository. Child CI owns Go tests,
Kong coverage, deployment guards, UI type checks, tests and builds. The parent's admin integration job
checks the pinned child revisions and verifies that backend and desktop token-pricing defaults agree.
