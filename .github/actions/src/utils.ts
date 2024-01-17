import { EOL } from 'os'
import { summary } from './summary.js'
import prettier from 'prettier'
import prettierXmlPlugin from '@prettier/plugin-xml'
import { Config, PluginConfig } from 'svgo'

/**
 * Mozilla Public License 2.0 header for XML files
 */
export const XML_LICENSE = `<!-- This Source Code Form is subject to the terms of the Mozilla Public${EOL}   - License, v. 2.0. If a copy of the MPL was not distributed with this${EOL}   - file, You can obtain one at http://mozilla.org/MPL/2.0/. -->`
/**
 * File types that can be formatted
 */
export type FormattableFile = 'svg' | 'xml'

/**
 * Retrieves an input from the environment
 * E.g. if the environment variable is INPUT_FOO_BAR, then the name should be "foo_bar"
 *
 * @param name the name of the input
 * @param required whether the input is required
 * @returns the input value
 */
export function getInput(name: string, required = true): string {
  const val: string = getEnv(`INPUT_${name.replace(/ /g, '_').toUpperCase()}`)
  if (required && !val) {
    throw new Error(`Input required and not supplied: ${name}`)
  }

  return val.trim()
}

/**
 * Retrieves an environment variable
 *
 * @param name the name of the environment variable
 * @returns the environment variable value or an empty string if not found
 */
export function getEnv(name: string): string {
  return process.env[name] || ''
}

/**
 * Ensures that a license is present at the top of the file
 *
 * @param input the file contents
 * @returns the file contents with the license added if needed
 */
export function ensureLicense(input: string): string {
  // Because the license might have different line breaks, we use a regex to
  // match the beginning and end of the license and all whitespace in until the
  // next character after the license.
  const regex = new RegExp(
    '<!-- This Source Code Form is[\\s\\S]*?http://mozilla.org/MPL/2.0/. -->\\s*',
    'g',
  )
  // Remove the license from the file if it exists
  const output = input.replace(regex, '')
  // add the license to the top of the file
  return `${XML_LICENSE}${EOL}${output}`
}

/**
 * Wrapper function for actions that wraps the function in a try/catch block.
 * If the function throws an error, the error is logged, a warning is added
 * to the summary and the process exits with a non-zero exit code.
 *
 * @param fn Function to run in a try/catch block
 * @param errorSummary Message to add to the summary if the function throws an error
 * @returns Promise of the result of the function
 */
export async function tryCatch(fn: () => void, errorSummary: string) {
  try {
    return await fn()
  } catch (error) {
    console.log(`::error title=Action failed::${errorSummary}`)
    console.error(error)
    summary.addAlert('caution', errorSummary)
    summary.write()
    process.exit(1)
  }
}

/**
 * Formats a file using prettier.
 * Current config has been written for svg and xml files.
 *
 * @param type either "svg" or "xml"
 * @param content the file contents
 * @returns the formatted file contents
 */
export async function formatFile(type: FormattableFile, content: string) {
  if (!['svg', 'xml'].includes(type)) {
    throw new Error(`Invalid type to format: ${type}`)
  }

  const formatted = await prettier.format(content, {
    parser: 'xml',
    plugins: [prettierXmlPlugin],
    tabWidth: 4,
    printWidth: type === 'svg' ? 100000 : 80,
    singleAttributePerLine: false,
    htmlWhitespaceSensitivity: 'ignore',
    bracketSameLine: true,
    xmlWhitespaceSensitivity: 'ignore',
  })

  return formatted
}

/**
 * SVGO plugins that should run on all SVGs
 */
export const svgoBasePlugins: Exclude<Config['plugins'], undefined> = [
  'removeDesc',
  'removeStyleElement',
  'removeOffCanvasPaths',
  'removeNonInheritableGroupAttrs',
  'sortAttrs',
  {
    name: 'preset-default',
    params: {
      overrides: {
        removeViewBox: false,
      },
    },
  },
]

/**
 * Factory function to create an SVGO plugin that removes specified attributes
 *
 * @param attrs the attributes to remove
 * @returns the plugin config
 */
export function svgoRemoveAttrs(attrs: string[]): PluginConfig {
  const attrString = attrs.map((attr) => attr.trim()).join('|')
  return {
    name: 'removeAttrs',
    params: {
      attrs: `(${attrString})`,
    },
  }
}
