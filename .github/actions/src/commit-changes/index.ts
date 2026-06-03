import { execSync } from 'child_process'
import { simpleGit } from 'simple-git'
import { summary } from '../summary.js'
import { tryCatch } from '../utils.js'

const COMMIT_MESSAGE = 'Updated icons to match format conventions'

tryCatch(run, 'Failed to commit changes. See logs for details.')

async function run() {
  const status = await simpleGit().status()

  if (status.files.length === 0) {
    summary.addHeading('Did not commit any files', 3)
    summary.addRaw(`Did not commit because there were no changed files.`)
    summary.write()
    return
  }

  await simpleGit().add(status.files.map((file) => file.path))

  // Push auth comes from actions/checkout's persisted credentials;
  // only the committer identity needs to be configured here.
  setupGit()

  await simpleGit().commit(COMMIT_MESSAGE).push('origin')

  summary.addHeading(`Committed ${status.files.length} files`, 3)
  summary.write()
}

function setupGit() {
  execSync('git config --global user.email "actions@github.com"')
  execSync('git config --global user.name "GitHub Action"')
}
