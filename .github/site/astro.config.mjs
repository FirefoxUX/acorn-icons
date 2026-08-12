import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import svelte from '@astrojs/svelte'
import { defineConfig } from 'astro/config'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const siteRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(siteRoot, '../..')

const require = createRequire(import.meta.url)
const tintDist = path.dirname(require.resolve('tint'))

// Astro does not pass the command to the config, and the workaround below is
// only wanted for the dev server's dependency optimizer.
const isDev = process.argv.includes('dev')

// https://astro.build/config
export default defineConfig({
  site: 'https://firefoxux.github.io',
  base: process.env.SITE_BASE ?? '/acorn-icons',
  prefetch: {
    defaultStrategy: 'hover',
  },
  vite: {
    ssr: {
      noExternal: ['tint*'],
    },
    // Vite 8's rolldown scanner cannot follow the relative `.svelte` imports
    // between components of a Svelte library under `node_modules`: it wraps each
    // one as `virtual-module:...?id=N`, then fails to resolve the sibling file
    // and aborts the whole scan. Discovery is only there to find dependencies
    // that need pre-bundling, and nothing our islands import does, so turning it
    // off costs nothing. Revisit once rolldown resolves these.
    ...(isDev && {
      optimizeDeps: {
        noDiscovery: true,
        exclude: ['tint'],
      },
    }),
    server: {
      // The catalog reads the asset directories, which sit above the Astro root.
      fs: {
        allow: [repoRoot],
      },
    },
    resolve: {
      alias: {
        '~tint': tintDist,
        '@src': path.join(siteRoot, 'src'),
      },
    },
    css: {
      preprocessorOptions: {
        sass: {
          additionalData: (d) => {
            const prepend = `@use "@src/styles/utils.sass" as tint\n`
            const match = d.match(/^\s*/)
            const spaces = match ? match[0] : ''
            return `${spaces}${prepend}\n${d}`
          },
        },
      },
    },
    plugins: [
      // Downloads serve the original bytes, so the asset trees are copied
      // verbatim rather than passed through the build. Both trees are copied
      // whole, including the `illustrations/mobile/svg` copies that duplicate
      // `illustrations/desktop`: the catalog is what collapses duplicates into
      // one entry, and skipping folders here only risks dropping a file that
      // turns out not to have a desktop twin.
      //
      // The plugin keeps each file's path from the repository root, so `dest` is
      // just `assets` and the result matches the `assets/<repoPath>` URLs the
      // catalog builds.
      viteStaticCopy({
        targets: [
          {
            src: path.join(repoRoot, 'icons/**/*.{svg,pdf,xml}'),
            dest: 'assets',
          },
          {
            src: path.join(
              repoRoot,
              'illustrations/**/*.{svg,pdf,webp,xml}',
            ),
            dest: 'assets',
          },
        ],
      }),
    ],
  },
  integrations: [svelte()],
})
