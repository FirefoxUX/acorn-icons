import { EOL } from 'os';
import { constants, promises } from 'fs';
const { access, appendFile, writeFile } = promises;
export const SUMMARY_ENV_VAR = 'GITHUB_STEP_SUMMARY';
class Summary {
    _buffer;
    _filePath;
    constructor() {
        this._buffer = '';
    }
    async filePath() {
        if (this._filePath) {
            return this._filePath;
        }
        const pathFromEnv = process.env[SUMMARY_ENV_VAR];
        if (!pathFromEnv) {
            this._filePath = null;
            return this._filePath;
        }
        try {
            await access(pathFromEnv, constants.R_OK | constants.W_OK);
        }
        catch {
            throw new Error(`Unable to access summary file: '${pathFromEnv}'. Check if the file has correct read/write permissions.`);
        }
        this._filePath = pathFromEnv;
        return this._filePath;
    }
    wrap(tag, content, attrs = {}) {
        const htmlAttrs = Object.entries(attrs)
            .map(([key, value]) => ` ${key}="${value}"`)
            .join('');
        if (!content) {
            return `<${tag}${htmlAttrs}>`;
        }
        return `<${tag}${htmlAttrs}>${content}</${tag}>`;
    }
    async write(options) {
        const overwrite = !!options?.overwrite;
        const filePath = await this.filePath();
        if (!filePath) {
            console.log(`~~~ SUMMARY ~~~${EOL}${this._buffer}${EOL}~~~ END SUMMARY ~~~`);
            return this.emptyBuffer();
        }
        const writeFunc = overwrite ? writeFile : appendFile;
        await writeFunc(filePath, this._buffer, { encoding: 'utf8' });
        return this.emptyBuffer();
    }
    async clear() {
        return this.emptyBuffer().write({ overwrite: true });
    }
    stringify() {
        return this._buffer;
    }
    isEmptyBuffer() {
        return this._buffer.length === 0;
    }
    emptyBuffer() {
        this._buffer = '';
        return this;
    }
    addRaw(text, addEOL = false) {
        this._buffer += text;
        return addEOL ? this.addEOL() : this;
    }
    addEOL() {
        return this.addRaw(EOL);
    }
    addCodeBlock(code, lang) {
        const attrs = {
            ...(lang && { lang }),
        };
        const element = this.wrap('pre', this.wrap('code', code), attrs);
        return this.addRaw(element).addEOL();
    }
    addList(items, ordered = false) {
        const tag = ordered ? 'ol' : 'ul';
        const listItems = items.map((item) => this.wrap('li', item)).join('');
        const element = this.wrap(tag, listItems);
        return this.addRaw(element).addEOL();
    }
    addTable(rows) {
        const tableBody = rows
            .map((row) => {
            const cells = row
                .map((cell) => {
                if (typeof cell === 'string') {
                    return this.wrap('td', cell);
                }
                const { header, data, colspan, rowspan } = cell;
                const tag = header ? 'th' : 'td';
                const attrs = {
                    ...(colspan && { colspan }),
                    ...(rowspan && { rowspan }),
                };
                return this.wrap(tag, data, attrs);
            })
                .join('');
            return this.wrap('tr', cells);
        })
            .join('');
        const element = this.wrap('table', tableBody);
        return this.addRaw(element).addEOL();
    }
    addDetails(label, content) {
        const element = this.wrap('details', this.wrap('summary', label) + content);
        return this.addRaw(element).addEOL();
    }
    addImage(src, alt, options) {
        const { width, height } = options || {};
        const attrs = {
            ...(width && { width }),
            ...(height && { height }),
        };
        const element = this.wrap('img', null, { src, alt, ...attrs });
        return this.addRaw(element).addEOL();
    }
    addHeading(text, level) {
        const tag = `h${level}`;
        const allowedTag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)
            ? tag
            : 'h1';
        const element = this.wrap(allowedTag, text);
        return this.addRaw(element).addEOL();
    }
    addSeparator() {
        const element = this.wrap('hr', null);
        return this.addRaw(element).addEOL();
    }
    addBreak() {
        const element = this.wrap('br', null);
        return this.addRaw(element).addEOL();
    }
    addQuote(text, cite) {
        const attrs = {
            ...(cite && { cite }),
        };
        const element = this.wrap('blockquote', text, attrs);
        return this.addRaw(element).addEOL();
    }
    addLink(text, href) {
        const element = this.wrap('a', text, { href });
        return this.addRaw(element).addEOL();
    }
    addAlert(type, text) {
        const element = text
            .split(EOL)
            .map((line) => `> ${line}`)
            .join(EOL);
        const alert = `> [!${type.toUpperCase()}]${EOL}${element}`;
        return this.addRaw(alert).addEOL();
    }
}
const _summary = new Summary();
export const summary = _summary;
