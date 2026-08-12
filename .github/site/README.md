# Acorn asset viewer

A static site for browsing, searching and downloading the icons and
illustrations in this repository.

## Running locally

```sh
npm install
npm run dev
```

The catalog is read from `icons/` and `illustrations/` at the repository root, so
the `npm run` commands have to run from this directory.

## Layout

- `src/catalog/` builds the asset catalog at build time. Node APIs are fine here.
  `scan.ts` walks the trees, `normalize.ts` parses the four naming schemes,
  `sanitize.ts` rewrites SVGs for preview, and `build.ts` assembles it all.
- `src/lib/` is browser-safe: the side panel, the search matcher, URL helpers.
- `src/components/`, `src/pages/`, `src/styles/` are the site itself.

The groups the filter chips offer come from `icons/categories.json` at the
repository root, which is maintained by hand.

## Build-time lookups

The build asks searchfox and GitHub which in-tree files match each asset, and
which release the assets came from. Responses are cached under `.cache/` for a
day. On any error the affected section is left out.

| Variable | |
|---|---|
| `SITE_BASE` | Overrides the `/acorn-icons` base path. |
| `SITE_SKIP_UPSTREAM` | Skips every network lookup. |
| `SITE_UPSTREAM_REFRESH` | Ignores the cache. |
| `SEARCHFOX_BASE_URL` | Points searchfox queries elsewhere. |
