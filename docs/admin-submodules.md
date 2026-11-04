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

`shared/` is the shared-source submodule; `packages/i18n` is the independent `piperhex/remoteai-i18n` submodule.
Admin UI consumes a generated `@remoteai/shared` archive and installs `@remoteai/i18n` directly from an
immutable GitHub release. `vendor/source-lock.json` records both provenances; npm's lockfile pins integrity.
No language archive or editable translation table is maintained in the UI repository.

After updating shared components, run `npm run export:admin-ui`. It exports only shared components and
pins the language package's published version. In `apps/admin-ui`, run `npm install` and `npm run check`,
then commit and push the child before updating its parent gitlink. Language changes are made and released
in `remoteai-i18n`, followed by explicit dependency updates in consumers.

The backend also installs that published package. `npm run generate:i18n` generates Go messages with its
`admin` profile; `npm run check:i18n` verifies them. Docker builds verify the same output before compiling.
Its former local language package is removed. Both applications preserve their existing language policies.

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
