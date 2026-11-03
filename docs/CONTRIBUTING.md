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

You can run releases without creating a token: Release Please falls back to GitHub Actions' built-in `GITHUB_TOKEN`. However, GitHub may hold workflows triggered by a PR opened with that token for approval. Since the release PR needs the `verify` check, you may have to approve its workflow run manually before merging. A dedicated token lets the release PR's checks start without that manual approval. This is optional convenience, not a prerequisite for Release Please to create releases. See GitHub's [GITHUB_TOKEN workflow behavior](https://docs.github.com/en/actions/concepts/security/github_token).

### Optional: create a token to avoid approving release PR workflows

1. Open GitHub [fine-grained personal access tokens](https://github.com/settings/personal-access-tokens) and choose **Generate new token**.
2. Give it a descriptive name such as `aiostreams-trakt-tracker releases`, select yourself as the resource owner, and set an expiration you can maintain. If this is an organization-owned repository, the organization may need to approve the token.
3. Under **Repository access**, choose **Only select repositories** and select `aiostreams-trakt-tracker`.
4. Under **Repository permissions**, grant **Contents: Read and write**, **Pull requests: Read and write**, and **Issues: Read and write**. GitHub requires metadata read access automatically. These are the permissions used by this workflow to create/update the release PR, version files, tag, release, and changelog.
5. Generate the token and copy it immediately. GitHub shows the token only once. Do not commit it or paste it into a chat or issue.
6. In the repository, open **Settings → Secrets and variables → Actions → New repository secret**. Set the name to exactly `RELEASE_PLEASE_TOKEN`, paste the token as its value, and save.

The workflow already references this exact secret name in `.github/workflows/ci.yml`; if it is absent, Release Please uses `GITHUB_TOKEN`. If the personal token expires or is revoked, either create a replacement with the same repository scope and permissions or remove/update the repository secret to return to the built-in token. A GitHub App is another option if you already manage one or want automation owned by an installation, but it requires creating/installing the app and changing the workflow to mint an installation token. See GitHub's [fine-grained token guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) and [Actions secrets guide](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions).

## Checks

The `verify` job runs the Docker test build, which installs locked dependencies, typechecks/builds the TypeScript app, and runs the Vitest suite, then validates both Compose configurations. Run `npm run typecheck` and `npm test` locally when changing application code. Docker is needed to reproduce the complete CI job.
