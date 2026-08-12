import { execSync } from 'child_process'
import fs from 'fs'
import { simpleGit } from 'simple-git'
import { summary } from '../summary.js'
import { getInput, tryCatch, writeFeedback } from '../utils.js'

const DEFAULT_COMMIT_MESSAGE = 'Updated icons to match format conventions'

async function run() {
  const status = await simpleGit().status()

  if (status.files.length === 0) {
    summary.addHeading('Did not commit any files', 3)
    summary.addRaw(`Did not commit because there were no changed files.`)
    await summary.write()
    return
  }

  // The bot has no write access to a fork, so the reformatted files would be
  // thrown away with the runner and the PR would merge unformatted behind a
  // green check. Fail instead and tell the author how to do it themselves.
  if (isFork()) {
    await reportFork(status.files.map((file) => file.path))
    return
  }

  await simpleGit().add(status.files.map((file) => file.path))

  // Push auth comes from actions/checkout's persisted credentials;
  // only the committer identity needs to be configured here.
  setupGit()

  const message = getInput('message', false) || DEFAULT_COMMIT_MESSAGE
  await simpleGit().commit(message)
  await push()

  summary.addHeading(`Committed ${status.files.length} files`, 3)
  await summary.write()
}

/**
 * Pushes, rebasing once if someone pushed to the branch while the transforms
 * were running. A conflict means the author edited the same file the bot just
 * reformatted, which nothing here can resolve, so say so and let the next
 * push start from a clean checkout.
 */
async function push() {
  try {
    await simpleGit().push('origin')
  } catch {
    console.log('Push rejected, rebasing on the remote branch and retrying.')
    try {
      await simpleGit().pull(['--rebase'])
      await simpleGit().push('origin')
    } catch {
      await reportBranchMoved()
    }
  }
}

async function reportBranchMoved() {
  const title = 'The branch moved while the formatter was running'

  summary.addHeading(title, 3)
  summary.addAlert('caution', 'Could not push the formatting changes.')

  writeFeedback({
    title,
    summary: 'Push again and the formatter will rerun on the new commit.',
    body: [
      'Someone pushed to this branch while the formatter was reformatting the same files, so its changes could not be applied on top.',
      '',
      'Nothing is lost. Push any new commit, or close and reopen the pull request, and the formatter will run again from the current state of the branch.',
    ].join('\n'),
  })

  await summary.write()
  process.exit(1)
}

function isFork(): boolean {
  const eventPath = process.env.GITHUB_EVENT_PATH
  const repository = process.env.GITHUB_REPOSITORY
  if (!eventPath || !repository || !fs.existsSync(eventPath)) {
    return false
  }
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
  const headRepo = event?.pull_request?.head?.repo?.full_name
  return Boolean(headRepo) && headRepo !== repository
}

async function reportFork(files: string[]) {
  const title =
    files.length === 1
      ? '1 file needs formatting'
      : `${files.length} files need formatting`

  summary.addHeading(title, 3)
  summary.addList(files.map((file) => `<code>${file}</code>`))

  writeFeedback({
    title,
    summary: `${title}. Run the formatter locally and push the result.`,
    body: [
      files.map((file) => `- \`${file}\``).join('\n'),
      '',
      'These files do not match the format conventions, and the bot cannot push to a fork.',
      '',
      'To fix them, run the following (requires Node.js):',
      '',
      '```',
      'cd .github/actions',
      'npm ci',
      'npm run transform',
      '```',
      '',
      'Then commit the changed files and push.',
    ].join('\n'),
  })

  await summary.write()
  process.exit(1)
}

function setupGit() {
  execSync('git config --global user.email "actions@github.com"')
  execSync('git config --global user.name "GitHub Action"')
}

// Runs last so the constants above are initialized before `run` reads them.
tryCatch(run, 'Failed to commit changes. See logs for details.')
