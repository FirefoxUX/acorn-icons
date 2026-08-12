import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { vitePreprocess } from '@astrojs/svelte'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const utilsSassAbsolute = path.join(__dirname, 'src/styles/utils.sass')

export default {
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
