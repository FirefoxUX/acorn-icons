import fs from 'node:fs';
import fg from 'fast-glob';
import { optimize } from 'svgo';
import { summary } from '../summary.js';
import { ensureLicense, formatFile, getInput, svgoBasePlugins, svgoRemoveAttrs, tryCatch, } from '../utils.js';
tryCatch(run, 'Failed to check mobile files. See logs for details.');
async function run() {
    const filesGlob = getInput('files', true);
    const fileType = getInput('file_type', true);
    const files = await fg(filesGlob);
    if (files.length === 0) {
        summary.addHeading(':desktop_computer: No files found', 3);
        summary.addAlert('warning', `No files found matching "${filesGlob}".`);
        summary.write();
        return;
    }
    const changedFiles = [];
    for (const file of files) {
        if (await updateMobileIcon(file, fileType)) {
            changedFiles.push(file);
        }
    }
    if (changedFiles.length === 0) {
        summary.addHeading(`:iphone: No ${fileType.toUpperCase()} files changed`, 3);
        summary.addRaw(`Checked ${files.length} ${fileType.toUpperCase()} files and made no changes.`);
        summary.write();
        return;
    }
    summary.addHeading(`:iphone: Updated ${changedFiles.length} mobile ${fileType.toUpperCase()} files`, 3);
    summary.addList(changedFiles);
    summary.write();
}
async function updateMobileIcon(path, type) {
    if (!path.endsWith(`.${type}`)) {
        return false;
    }
    console.log(`Checking ${path}`);
    const originalFile = fs.readFileSync(path, 'utf8');
    let formatted = originalFile;
    if (type === 'svg') {
        formatted = optimize(originalFile, {
            plugins: [
                svgoRemoveAttrs([
                    'id',
                    'data-name',
                    'class',
                    'stroke',
                    'stroke-width',
                    'stroke-miterlimit',
                ]),
                ...svgoBasePlugins,
            ],
        }).data;
    }
    formatted = await formatFile(type, originalFile);
    const withLicense = ensureLicense(formatted);
    const fileChanged = withLicense !== originalFile;
    if (fileChanged) {
        fs.writeFileSync(path, withLicense);
    }
    return fileChanged;
}
