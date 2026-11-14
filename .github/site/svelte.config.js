import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { vitePreprocess } from '@astrojs/svelte'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const utilsSassAbsolute = path.join(__dirname, 'src/styles/utils.sass')

export default {
  // Astro keeps only the styles of modules a page imports statically and drops
  // the rest from the build. The color picker loads its popover on demand, so
  // that component, its children and the text field it uses would arrive
  // unstyled. Injecting the CSS from the JS puts it in the same chunk as the
  // component.
  vitePlugin: {
    dynamicCompileOptions({ filename }) {
      if (
        filename.includes(`${path.sep}ColorPicker${path.sep}`) ||
        filename.endsWith(`${path.sep}TextField.svelte`)
      ) {
        return { css: 'injected' }
      }
    },
  },
  preprocess: vitePreprocess({
    style: {
      css: {
        preprocessorOptions: {
          sass: {
            additionalData: (d) => {
              const prepend = `@use "${utilsSassAbsolute}" as tint\n`
              const match = d.match(/^\s*/)
              const spaces = match ? match[0] : ''
              return `${spaces}${prepend}\n${d}`
            },
          },
        },
      },
    },
  }),
}
