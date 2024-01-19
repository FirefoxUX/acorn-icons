import { promises } from 'fs'
import { execSync } from 'child_process'
import { simpleGit } from 'simple-git'
import { summary } from '../summary.js'
import { tryCatch } from '../utils.js'

const { writeFile } = promises
const COMMIT_MESSAGE = 'Updated icons to match format conventions'

tryCatch(run, 'Failed to commit changes. See logs for details.')

async function run() {
  // get all changed files from git
  const status = await simpleGit().status()

  // if there are no changed files, exit
  if (status.files.length === 0) {
    summary.addHeading(':arrow_up: Did not commit any files', 3)
    summary.addRaw(`Did not commit because there were no changed files.`)
    summary.write()
    return
  }

  // since there are changed files, add them to staging
  await simpleGit().add(status.files.map((file) => file.path))

  // now we need to setup git credentials
  await setupGit()

  // commit and push
  await simpleGit().commit(COMMIT_MESSAGE).push('origin')

  // Add commit summary
  summary.addHeading(`:arrow_up: Committed ${status.files.length} files`, 3)
  summary.write()
}

/**
 * Setup git credentials if available
 */
async function setupGit() {
  if (!process.env.GITHUB_ACTOR) return
  const netrcContent = `
    machine github.com
    login ${process.env.GITHUB_ACTOR}
    password ${process.env.INPUT_GITHUB_TOKEN}
    machine api.github.com
    login ${process.env.GITHUB_ACTOR}
    password ${process.env.INPUT_GITHUB_TOKEN}
  `
  await writeFile(`${process.env.HOME}/.netrc`, netrcContent, { mode: 0o600 })
  execSync('git config --global user.email "actions@github.com"')
  execSync('git config --global user.name "GitHub Action"')
}
