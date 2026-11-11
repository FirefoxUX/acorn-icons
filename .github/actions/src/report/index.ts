// Runs under plain `node` with type stripping and no `npm ci`, so it must not
// import from the rest of this package. A broken install is one of the
// failures it has to report. `Finding` mirrors the type in `../utils.ts`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type Finding = {
  kind: 'fix' | 'automation'
  title: string
  body: string
}

export type JobResult = 'success' | 'failure' | 'cancelled' | 'skipped'

export type JobReport = {
  id: string
  name: string
  statusContext: string
  result: JobResult
  findings: Finding[]
  logUrl?: string
  failedStep?: string
}

export type Status = { state: 'success' | 'failure'; description: string }

export const MARKER = '<!-- acorn-icons-bot:icon-actions -->'
const RUN_PREFIX = '<!-- acorn-icons-bot:run='

// The job ids and display names in icon-actions.yaml. The names are what
// the Jobs API returns, and the contexts are what branch protection may
// require.
export const JOBS = [
  {
    id: 'checks',
    name: 'Format and validate',
    statusContext: 'Icons / validation',
  },
  {
    id: 'conventions',
    name: 'Illustration naming',
    statusContext: 'Illustrations / naming',
  },
  {
    id: 'categories',
    name: 'Icon categories',
    statusContext: 'Icons / categories',
  },
  {
    id: 'filename-case',
    name: 'Case collisions',
    statusContext: 'Filenames / case',
  },
]

/**
 * Findings a job recorded, or a generic automation finding when the job
 * failed without recording any. Skipped jobs have nothing to report.
 */
export function effectiveFindings(job: JobReport): Finding[] {
  if (job.findings.length > 0) {
    return job.findings
  }
  if (job.result === 'failure') {
    const where = job.failedStep
      ? `The step \`${job.failedStep}\` of \`${job.name}\` failed`
      : `\`${job.name}\` stopped unexpectedly`
    return [
      {
        kind: 'automation',
        title: `\`${job.name}\` did not finish`,
        body: `${where} before it could say what was wrong. This is a problem with the automation, not with your icons.`,
      },
    ]
  }
  if (job.result === 'cancelled') {
    return [
      {
        kind: 'automation',
        title: `\`${job.name}\` was cancelled`,
        body: 'The run was stopped before this check finished. Push a new commit or re-run the workflow to check again.',
      },
    ]
  }
  return []
}

function withLogLink(finding: Finding, job: JobReport): string {
  if (finding.kind !== 'automation' || !job.logUrl) {
    return finding.body
  }
  return `${finding.body}\n\n[Open the log](${job.logUrl})`
}

/** The sticky comment, or null when every job passed. */
export function renderComment(jobs: JobReport[], runId: string): string | null {
  const fixes: string[] = []
  const automation: string[] = []

  for (const job of jobs) {
    for (const finding of effectiveFindings(job)) {
      const section = `#### ${finding.title}\n\n${withLogLink(finding, job)}`
      ;(finding.kind === 'fix' ? fixes : automation).push(section)
    }
  }

  if (fixes.length === 0 && automation.length === 0) {
    return null
  }

  const parts = [MARKER, `${RUN_PREFIX}${runId} -->`]
  if (fixes.length > 0) {
    const noun = fixes.length === 1 ? 'thing needs' : 'things need'
    parts.push(
      `### ${fixes.length} ${noun} your attention`,
      '',
      fixes.join('\n\n'),
      '',
    )
  }
  if (automation.length > 0) {
    parts.push(
      '### The automation had a problem',
      '',
      'Sorry about that. This is not caused by your icons.',
      '',
      automation.join('\n\n'),
    )
  }
  return parts.join('\n')
}

/** Run id recorded in an existing comment, or 0 when there is none. */
export function recordedRunId(body: string): number {
  const start = body.indexOf(RUN_PREFIX)
  if (start === -1) {
    return 0
  }
  return Number.parseInt(body.slice(start + RUN_PREFIX.length), 10) || 0
}

/** Commit status for one job, or null when the job was skipped. */
export function statusFor(job: JobReport): Status | null {
  if (job.result === 'skipped') {
    return null
  }
  const findings = effectiveFindings(job)
  if (findings.length === 0) {
    return { state: 'success', description: 'All checks passed.' }
  }
  const first = findings[0]
  const description =
    first.kind === 'automation'
      ? 'The automation had a problem. See the PR comment.'
      : first.title.replace(/`/g, '')
  return {
    state: 'failure',
    description:
      description.length <= 140
        ? description
        : `${description.slice(0, 137)}...`,
  }
}

export function parseFindings(text: string): Finding[] {
  const findings: Finding[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue
    }
    try {
      findings.push(JSON.parse(line))
    } catch {
      // A truncated last line means the job died mid-write. Its result still
      // marks the job as failed.
    }
  }
  return findings
}

type ApiJob = {
  name: string
  html_url: string
  steps?: { name: string; conclusion: string | null }[]
}

type ApiComment = { id: number; body?: string }

type Api = (method: string, route: string, body?: unknown) => Promise<unknown>

function createApi(token: string, apiUrl: string): Api {
  return async (method, route, body) => {
    const response = await fetch(`${apiUrl}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(`${method} ${route} returned ${response.status}`)
    }
    return response.status === 204 ? null : response.json()
  }
}

async function paginate<T>(
  api: Api,
  route: string,
  key?: string,
): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; ; page++) {
    const joiner = route.includes('?') ? '&' : '?'
    const data = (await api(
      'GET',
      `${route}${joiner}per_page=100&page=${page}`,
    )) as T[] | Record<string, T[]>
    const batch = Array.isArray(data) ? data : data[key ?? '']
    items.push(...batch)
    if (batch.length < 100) {
      return items
    }
  }
}

function readFindingsFor(dir: string, id: string): Finding[] {
  const file = path.join(dir, `findings-${id}`, 'findings.jsonl')
  return fs.existsSync(file) ? parseFindings(fs.readFileSync(file, 'utf8')) : []
}

async function run() {
  const env = process.env
  const repository = env.GITHUB_REPOSITORY!
  const runId = env.GITHUB_RUN_ID!
  const needs = JSON.parse(env.NEEDS ?? '{}')
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH!, 'utf8'))
  const pullRequest = event.pull_request
  const api = createApi(
    env.GITHUB_TOKEN!,
    env.GITHUB_API_URL ?? 'https://api.github.com',
  )
  const dir = env.FINDINGS_DIR ?? 'findings'

  // The job list is only needed for log links and failed step names. The
  // comment is still worth posting without them.
  let apiJobs: ApiJob[] = []
  try {
    apiJobs = await paginate<ApiJob>(
      api,
      `/repos/${repository}/actions/runs/${runId}/jobs?filter=latest`,
      'jobs',
    )
  } catch (error) {
    console.warn(`Could not list the jobs of this run: ${error}`)
  }

  const jobs: JobReport[] = JOBS.map((job) => {
    const apiJob = apiJobs.find((candidate) => candidate.name === job.name)
    return {
      ...job,
      result: (needs[job.id]?.result ?? 'skipped') as JobResult,
      findings: readFindingsFor(dir, job.id),
      logUrl: apiJob?.html_url,
      failedStep: apiJob?.steps?.find((step) => step.conclusion === 'failure')
        ?.name,
    }
  })

  const comment = renderComment(jobs, runId)
  const summaryFile = env.GITHUB_STEP_SUMMARY
  if (comment !== null && summaryFile) {
    fs.appendFileSync(summaryFile, `${comment}\n`)
  }
  if (!pullRequest) {
    return
  }

  const base = `/repos/${repository}/issues`
  try {
    const comments = await paginate<ApiComment>(
      api,
      `${base}/${pullRequest.number}/comments`,
    )
    const existing = comments.find((item) => item.body?.includes(MARKER))
    if (comment === null) {
      if (existing) {
        await api('DELETE', `${base}/comments/${existing.id}`)
      }
    } else if (existing) {
      if (recordedRunId(existing.body ?? '') <= Number(runId)) {
        await api('PATCH', `${base}/comments/${existing.id}`, { body: comment })
      }
    } else {
      await api('POST', `${base}/${pullRequest.number}/comments`, {
        body: comment,
      })
    }
  } catch (error) {
    // Fork pull requests get a read-only token. The job summary above still
    // carries the message.
    console.warn(`Could not update the pull request comment: ${error}`)
  }

  for (const job of jobs) {
    const status = statusFor(job)
    if (status === null) {
      continue
    }
    try {
      await api(
        'POST',
        `/repos/${repository}/statuses/${pullRequest.head.sha}`,
        {
          ...status,
          context: job.statusContext,
        },
      )
    } catch (error) {
      console.warn(`Could not set the status ${job.statusContext}: ${error}`)
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
