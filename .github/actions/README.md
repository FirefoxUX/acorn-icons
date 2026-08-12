# Acorn Icons Actions

This folder contains custom GitHub Actions for the acorn-icons repository. The scripts are written in TypeScript and run directly via [`tsx`](https://github.com/privatenumber/tsx) — there is no build step and no compiled output committed to the repository.

Each folder in `./src` contains a single action, consisting of an `index.ts` file and an `action.yaml` file. `./src/utils.ts` contains utility functions shared between actions and `./src/summary.ts` contains functions to generate and save GitHub Action summaries.

### Development

#### Creating or editing an action

Run `npm install` to install dependencies (this also installs `tsx`).

To create a new action, create a new folder in `./src` with an `index.ts` and `action.yaml` file. The `index.ts` file should self-invoke a function that handles the action's inputs. The `action.yaml` file declares the action's metadata and should use `runs.using: composite` with a step that invokes `tsx` against `index.ts`. The existing actions are working templates.

To type-check your changes before pushing, run `npm run typecheck`. CI runs the same check.

To test an action locally, navigate to the root of the repository and run:

```bash
INPUT_FOO_BAR='value' \
  .github/actions/node_modules/.bin/tsx .github/actions/src/<action>/index.ts
```

Inputs are passed as environment variables prefixed with `INPUT_` (uppercased).

### Adding an action to a workflow

Actions need to be part of a workflow to be run. Workflows are defined in `.github/workflows` and are written in YAML. To use a custom action in a workflow, set the relative path from the root of the repository to the directory containing the action's `action.yaml` as the value of the `uses` key. For example, to use the `commit-changes` action:

```yaml
- uses: ./.github/actions/src/commit-changes
```

The workflow must run `npm ci` (in `./.github/actions`) before any of these `uses:` steps so that `tsx` and the runtime dependencies are available.

## Available Actions

### `commit-changes`

Commits and pushes any files modified by prior steps in the workflow. If no files changed, the action exits without committing. Push auth is provided by `actions/checkout`'s persisted credentials — no token input is needed.

If the pull request comes from a fork, the bot has no write access, so the action reports the unformatted files and fails instead of pushing. The PR comment tells the author to run `npm run transform` themselves.

A rejected push is retried once after `git pull --rebase`, which covers someone pushing to the branch while the transforms were running.

**Inputs**

- `message`: Commit message. Defaults to `Updated icons to match format conventions`. (optional)

### `desktop-transform`

Transforms SVG files in the repository to follow the format conventions for desktop icons. Runs SVGO with custom plugins, formats with Prettier, and ensures the MPL 2.0 license header is present.

**Inputs**

- `files`: Glob pattern of files to transform. E.g. `icons/desktop/**/*.svg`. (required)

### `mobile-transform`

Transforms either SVG or XML files in the repository to follow the format conventions for mobile icons. For SVG files, runs SVGO with custom plugins. For both file types, formats with Prettier and ensures the MPL 2.0 license header is present.

**Inputs**

- `files`: Glob pattern of files to transform. E.g. `icons/mobile/**/*.svg`. (required)
- `file_type`: The type of file to transform. Either `svg` or `xml`. (required)

### `illustration-transform`

Formats illustrations and ensures the MPL 2.0 license header is present.

Do not replace this with `mobile-transform`. Every illustration paints through `fill="url(#id)"` into a gradient definition, and the icon transforms strip `id` (and, on desktop, `fill`), which would blank out the entire set. This action deliberately skips SVGO's `preset-default` — `cleanupIds` and `removeViewBox` live in there — and removes no attributes at all. Its SVGO pass only drops export noise and normalizes byte layout.

**Inputs**

- `files`: Glob pattern of files to transform. E.g. `illustrations/**/*.svg`. (required)
- `file_type`: The type of file to transform. Either `svg` or `xml`. (required)

### `illustration-lint`

Checks every filename under `illustrations` against the per-format naming conventions, and checks that each asset is present in all the format trees it belongs in.

Naming problems fail the check, because they are always fixable by renaming the file. A missing format is reported as a warning and does not fail, since an asset is routinely in flight while one export is still outstanding.

No inputs. Writes its feedback payload to `illustration-feedback.json` rather than `icon-feedback.json`, so it must run in its own job with a matching `feedback_path`.

### `categories-format`

Sorts `icons/categories.json` into a canonical order and rewrites it: categories alphabetical, icons alphabetical within each, duplicates dropped, two-space indent. Contributors can append an icon to the end of any list and the bot files it away, which keeps hand edits from producing noisy diffs.

Runs alongside the asset transforms so `commit-changes` pushes the result. It reports nothing and fails nothing — if the file is unparseable it leaves it untouched, because `categories-check` reports the syntax error properly and rewriting a file we cannot parse would only lose work.

No inputs.

### `categories-check`

Validates `icons/categories.json`, which the catalog site reads to group icons into filter chips.

Fails the check on anything that would break or corrupt the build: invalid JSON, a missing or malformed `categories` object, an entry that is not a lowercase hyphenated name, or one icon listed under two categories. It does not fail on an entry naming an icon that no longer exists, or a category nothing uses — neither harms the site, and failing on them would block a rename or a deletion until someone pruned the file.

Separately, and without failing, it names any icon the pull request adds that no category covers. Leaving an icon uncategorized is allowed, so this is only a reminder. Icons that were already uncategorized before the pull request are ignored.

**Inputs**

- `base_ref`: Branch the pull request targets. Preferred, because its tip stays current as other pull requests land, so their icons are not mistaken for this one's. (optional)
- `base_sha`: Commit to diff against, used when the base branch is not fetched. Without either input only the file is validated. (optional)

Writes `categories-feedback.json` for the blocking half and `categories-notice.json` for the reminder, so it needs its own job with a `post-feedback` and a `post-notice` step pointed at each.

### `post-notice`

Upserts a sticky PR comment from a JSON payload and deletes it once the payload is gone. Writes no commit status, so the check stays green.

This exists because `post-feedback` treats the presence of a payload as a failure, which makes it unusable for advice the author is free to ignore. Because the comment is edited rather than replaced, and GitHub does not notify on edits, the author is notified once no matter how many times they push.

**Inputs**

- `marker`: Hidden HTML comment identifying the sticky comment. Use a distinct value per notice. (required)
- `notice_path`: Absolute path to the JSON payload. (required)
- `github_token`: Defaults to `github.token`. (optional)
