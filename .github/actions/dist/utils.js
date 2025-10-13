import { EOL } from 'os';
import { summary } from './summary.js';
import prettier from 'prettier';
import prettierXmlPlugin from '@prettier/plugin-xml';
export const XML_LICENSE = `<!-- This Source Code Form is subject to the terms of the Mozilla Public${EOL}   - License, v. 2.0. If a copy of the MPL was not distributed with this${EOL}   - file, You can obtain one at http://mozilla.org/MPL/2.0/. -->`;
export function getInput(name, required = true) {
    const val = getEnv(`INPUT_${name.replace(/ /g, '_').toUpperCase()}`);
    if (required && !val) {
        throw new Error(`Input required and not supplied: ${name}`);
    }
    return val.trim();
}
export function getEnv(name) {
    return process.env[name] || '';
}
export function ensureLicense(input) {
    const regex = new RegExp('<!-- This Source Code Form is[\\s\\S]*?http://mozilla.org/MPL/2.0/. -->\\s*', 'g');
    const output = input.replace(regex, '');
    return `${XML_LICENSE}${EOL}${output}`;
}
export async function tryCatch(fn, errorSummary) {
    try {
        return await fn();
    }
    catch (error) {
        console.log(`::error title=Action failed::${errorSummary}`);
        console.error(error);
        summary.addAlert('caution', errorSummary);
        summary.write();
        process.exit(1);
    }
}
export async function formatFile(type, content) {
    if (!['svg', 'xml'].includes(type)) {
        throw new Error(`Invalid type to format: ${type}`);
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
    });
    return formatted;
}
export const svgoBasePlugins = [
    'removeDesc',
    'removeStyleElement',
    'removeOffCanvasPaths',
    'removeNonInheritableGroupAttrs',
    'sortAttrs',
    'preset-default',
];
export function svgoRemoveAttrs(attrs) {
    const attrString = attrs.map((attr) => attr.trim()).join('|');
    return {
        name: 'removeAttrs',
        params: {
            attrs: `(${attrString})`,
        },
    };
}
