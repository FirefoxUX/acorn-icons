/**
 * The site is published under a project Pages subpath, so no link may be
 * written root-relative. `BASE_URL` is `/acorn-icons` with no trailing slash,
 * and `/` when the base is unset, so both ends are normalized here rather than
 * at every call site.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '')

export function url(path: string): string {
  return `${BASE}/${path.replace(/^\/+/, '')}`
}

export function assetHref(id: string): string {
  return url(`asset/${id}/`)
}

/**
 * The file on the default branch rather than a pinned commit, so the link keeps
 * pointing at the current version of the asset.
 */
export function repoFileHref(repoPath: string): string {
  const path = repoPath.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/FirefoxUX/acorn-icons/blob/main/${path}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const kilobytes = bytes / 1024
  return kilobytes < 100
    ? `${kilobytes.toFixed(1)} kB`
    : `${Math.round(kilobytes)} kB`
}
