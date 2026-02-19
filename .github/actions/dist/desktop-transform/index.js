import { optimize } from 'svgo';
import fg from 'fast-glob';
import fs from 'fs';
import { summary } from '../summary.js';
import { ensureLicense, formatFile, getInput, svgoBasePlugins, svgoRemoveAttrs, tryCatch, } from '../utils.js';
tryCatch(run, 'Failed to check desktop SVGs. See logs for details.');
async function run() {
    const filesGlob = getInput('files', true);
    const files = await fg(filesGlob);
    if (files.length === 0) {
        summary.addHeading(':desktop_computer: No files found', 3);
        summary.addAlert('warning', `No files found matching "${filesGlob}".`);
        summary.write();
        return;
    }
    const changedFiles = [];
    for (const file of files) {
        if (await updateDesktopIcon(file)) {
            changedFiles.push(file);
        }
    }
    if (changedFiles.length === 0) {
        summary.addHeading(':desktop_computer: No SVGs changed', 3);
        summary.addRaw(`Checked ${files.length} desktop SVGs and made no changes.`);
        summary.write();
        return;
    }
    summary.addHeading(`:desktop_computer: Updated ${changedFiles.length} desktop SVGs`, 3);
    summary.addList(changedFiles);
    summary.write();
}
async function updateDesktopIcon(path) {
    if (!path.endsWith('.svg')) {
        return false;
    }
    console.log(`Checking ${path}`);
    const originalFile = fs.readFileSync(path, 'utf8');
    const result = optimize(originalFile, {
        plugins: [
            svgoRemoveAttrs([
                'id',
                'data-name',
                'class',
                'fill',
                'stroke',
                'stroke-width',
                'stroke-miterlimit',
                'fill-opacity',
            ]),
            viewBoxAndDimensions,
            addContextFill,
            ...svgoBasePlugins,
        ],
    });
    const formatted = await formatFile('svg', result.data);
    const withLicense = ensureLicense(formatted);
    const fileChanged = withLicense !== originalFile;
    if (fileChanged) {
        fs.writeFileSync(path, withLicense);
    }
    return fileChanged;
}
const viewBoxAndDimensions = {
    name: 'viewBoxAndDimensions',
    fn: () => ({
        element: {
            enter(node) {
                if (node.name !== 'svg') {
                    return;
                }
                const viewBox = node.attributes.viewBox;
                const width = node.attributes.width;
                const height = node.attributes.height;
                if (viewBox && width && height) {
                    return;
                }
                if ((viewBox && !width) || !height) {
                    const [, , w, h] = viewBox.split(' ');
                    node.attributes.width = w;
                    node.attributes.height = h;
                }
                else if (width && height && !viewBox) {
                    node.attributes.viewBox = `0 0 ${width} ${height}`;
                }
                else {
                    throw new Error('SVG has no width, height, or viewBox');
                }
            },
        },
    }),
};
const addContextFill = {
    name: 'addContextFill',
    fn: () => ({
        element: {
            enter(node) {
                if (node.name !== 'svg') {
                    return;
                }
                node.attributes.fill = 'context-fill';
                node.attributes['fill-opacity'] = 'context-fill-opacity';
            },
        },
    }),
};
