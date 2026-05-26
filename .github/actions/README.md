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

No inputs.

### `desktop-transform`

Transforms SVG files in the repository to follow the format conventions for desktop icons. Runs SVGO with custom plugins, formats with Prettier, and ensures the MPL 2.0 license header is present.

**Inputs**

- `files`: Glob pattern of files to transform. E.g. `icons/desktop/**/*.svg`. (required)

### `mobile-transform`

Transforms either SVG or XML files in the repository to follow the format conventions for mobile icons. For SVG files, runs SVGO with custom plugins. For both file types, formats with Prettier and ensures the MPL 2.0 license header is present.

**Inputs**

- `files`: Glob pattern of files to transform. E.g. `icons/mobile/**/*.svg`. (required)
- `file_type`: The type of file to transform. Either `svg` or `xml`. (required)
