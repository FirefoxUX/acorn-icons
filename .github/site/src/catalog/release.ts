/**
 * Names the release the assets on this site came from.
 *
 * A release-triggered deploy already knows its own tag, so that is used
 * verbatim. Anything else, a push to the site directory or a local build, asks
 * GitHub for the newest release instead. Neither may fail the build: without an
 * answer the footer simply omits the version.
 */

import { fetchText } from './upstream.ts'

const RELEASES_URL =
  'https://api.github.com/repos/FirefoxUX/acorn-icons/releases/latest'

export type Release = {
  tag: string
  href: string
  /** Absent when the tag came from the workflow rather than the API. */
  publishedAt?: string
}

let pending: Promise<Release | undefined> | undefined

export function getRelease(): Promise<Release | undefined> {
  pending ??= resolve()
  return pending
}

function hrefFor(tag: string): string {
  return `https://github.com/FirefoxUX/acorn-icons/releases/tag/${encodeURIComponent(tag)}`
}

async function resolve(): Promise<Release | undefined> {
  if (process.env.SITE_SKIP_UPSTREAM) {
    return undefined
  }

  // Set by GitHub Actions on a release run, where it is the tag being deployed.
  const tag = process.env.GITHUB_REF_NAME
  if (process.env.GITHUB_EVENT_NAME === 'release' && tag) {
    return { tag, href: hrefFor(tag) }
  }

  try {
    const payload = JSON.parse(
      await fetchText(RELEASES_URL, {
        Accept: 'application/vnd.github+json',
      }),
    ) as { tag_name?: string; published_at?: string }
    if (!payload.tag_name) {
      return undefined
    }
    return {
      tag: payload.tag_name,
      href: hrefFor(payload.tag_name),
      publishedAt: payload.published_at,
    }
  } catch (reason) {
    console.warn(
      `[release] no version for the footer: ${reason instanceof Error ? reason.message : String(reason)}`,
    )
    return undefined
  }
}
