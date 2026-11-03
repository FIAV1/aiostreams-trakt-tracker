# Contributing

Changes are proposed through pull requests targeting `main`. The repository ruleset requires a passing `verify` check and squash merging; direct pushes and force pushes to `main` are blocked.

## Pull request titles and commits

Use a [Conventional Commit](https://www.conventionalcommits.org/) title. The title becomes the commit subject when a pull request is squash-merged, and Release Please uses it to decide whether and how to publish a new version.

Examples:

- `feat: add viewer-specific list sync` — minor version bump.
- `fix: retry Trakt rate limits` — patch version bump.
- `feat!: change the watch state API contract` — major version bump.
- `docs: clarify private network setup` — no release by itself.

Use a scope when it helps, such as `fix(auth): refresh expired device tokens`. For breaking changes, add `!` after the type/scope and describe the migration in the PR body. Do not hand-edit version numbers or release tags; Release Please prepares a version and changelog pull request.

Dependabot opens weekly npm and GitHub Actions update pull requests. Patch and minor npm updates are grouped; major updates are separate for review. Its PR titles use conventional `chore(deps)` or `ci(deps)` prefixes and pass through the same checks.

## Automated releases

After releasable changes land on `main`, Release Please opens or updates a release pull request. Review and squash-merge it to create the Git tag and GitHub Release. The release workflow builds and pushes the production image to GHCR only after the validation job passes.

Before enabling this workflow, add a repository Actions secret named `RELEASE_PLEASE_TOKEN`. It must be a fine-grained token with access to this repository and **Contents: read/write**, **Pull requests: read/write**, and **Issues: write** permissions. Release Please uses this token so GitHub starts CI checks for its generated release pull requests. Prefer a GitHub App token if you already operate a GitHub App for repository automation.

## Checks

The `verify` job runs the Docker test build, which installs locked dependencies, typechecks/builds the TypeScript app, and runs the Vitest suite, then validates both Compose configurations. Run `npm run typecheck` and `npm test` locally when changing application code. Docker is needed to reproduce the complete CI job.
