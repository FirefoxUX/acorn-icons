/**
 * Reads a URL at build time, through a cache on disk.
 *
 * The site pulls a few facts from GitHub and searchfox while it builds. None of
 * them may hold up a build, and none should cost a request on every dev server
 * restart, so every response is cached and every caller is expected to treat a
 * rejection as "show nothing".
 *
 * `SITE_UPSTREAM_REFRESH=1` ignores the cached copy.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { SITE_ROOT } from './scan.ts'

const CACHE_DIR = path.join(SITE_ROOT, '.cache/upstream')
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000

const USER_AGENT =
  'acorn-icons-site (+https://github.com/FirefoxUX/acorn-icons)'

/**
 * The readable stem is truncated, so the digest carries the uniqueness. Two
 * searchfox probes differ only in a size near the end and would otherwise share
 * a file.
 */
function cachePath(url: string): string {
  const stem = url
    .replace(/^https?:\/\/|[^a-z0-9]+/gi, '-')
    .slice(0, 80)
    .replace(/^-|-$/g, '')
  const digest = crypto
    .createHash('sha1')
    .update(url)
    .digest('hex')
    .slice(0, 12)
  return path.join(CACHE_DIR, `${stem}-${digest}.txt`)
}

export async function fetchText(
  url: string,
  headers: HeadersInit = {},
): Promise<string> {
  const cached = cachePath(url)
  if (!process.env.SITE_UPSTREAM_REFRESH) {
    const stat = fs.statSync(cached, { throwIfNoEntry: false })
    if (stat && Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      return fs.readFileSync(cached, 'utf8')
    }
  }

  // `fetch` rejects with a bare "fetch failed" for a DNS or TLS error, which
  // says nothing about which request broke, so the URL is attached here.
  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (cause) {
    throw new Error(`${String(cause)} requesting ${url}`, { cause })
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`)
  }
  const body = await response.text()

  // Written through a temporary file, because a build interrupted mid-write
  // would otherwise leave a half-response that parses as a failure for the whole
  // cache lifetime.
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const scratch = `${cached}.${process.pid}.tmp`
  fs.writeFileSync(scratch, body)
  fs.renameSync(scratch, cached)
  return body
}
