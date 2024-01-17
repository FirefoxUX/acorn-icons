# Acorn Icons Actions

This folder contains custom GitHub Actions for the acorn-icons repository. The scripts are written in TypeScript and need to be compiled before they can be used.

Each folder in `./src` contains a single action, consisting of an `index.ts` file and a `action.yaml` file. `./src/utils.ts` contains useful utility functions that are shared between actions and `./src/summary.ts` contains functions to generate and save GitHub Action summaries.

### Development

#### Creating or editing an action

Run `npm install` to install the dependencies.

To create a new action, simply create a new folder in `./src` with an `index.ts` and `action.yaml` file. The `index.ts` file needs to self-invoke a function that takes in the action's inputs and outputs. The `action.yaml` file needs to contain the action's metadata, including its inputs and outputs.

To compile the actions, run `npm run build`. This will compile the TypeScript files in `./src` and output the JavaScript (along with the `action.yaml` files) to `./dist`. Don't forget to recompile the actions after making changes to them. The compiled files are what GitHub will use to run the actions so they need to be committed to the repository too.

To test an action locally, navigate to the root of the repository and run `node path/to/action/index.js`. If your action requires inputs, you have to set up corresponding environment variables. For example, if your action requires an input called `foo_bar`, you have to set an environment variable called `INPUT_FOO_BAR`.

### Adding an action to a workflow

Actions need to be part of a workflow to be run. Workflows are defined in `.github/workflows` and are written in YAML. To use the the custom actions in a workflow, you need to set the relative path from the root of the repository to the action's `action.yaml` file as the value of the `uses` key. For example, if you want to use the `commit-changes` action in a workflow, you would set `uses: .github/actions/dist/commit-changes`.

## Available Actions

### `commit-changes`

This action commits changes to the repository. If any changes have been made to the repository by prior steps in the workflow, this action will commit those changes. If no changes have been made, this action will do nothing.

**Inputs**

- `message`: The commit message. (required)

### `desktop-transform`

This action transforms the SVG files in the repository follow the file format conventions for desktop icons. This means running svgo on the SVG files with custom plugins to remove unnecessary attributes and add missing attributes. The actions also formats the svg using prettier and adds a license comment to the top of the file if it is missing.

**Inputs**

- `files`: Glob pattern of files to transform. E.g. `icons/desktop/**/*.svg`. (required)

### `mobile-transform`

This action transforms either SVG or XML files in the repository follow the file format conventions for mobile icons. This means running prettier on the files and adding a license comment to the top of the file if it is missing. If the files are SVG files, the action will also run svgo on the SVG files with custom plugins to remove unnecessary attributes.

**Inputs**

- `files`: Glob pattern of files to transform. E.g. `icons/mobile/**/*.svg`. (required)
- `file_type`: The type of file to transform. Either `svg` or `xml`. (required)
