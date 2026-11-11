import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type JobReport,
  effectiveFindings,
  parseFindings,
  recordedRunId,
  renderComment,
  statusFor,
} from './index.ts'

function job(overrides: Partial<JobReport>): JobReport {
  return {
    id: 'checks',
    name: 'Format and validate',
    statusContext: 'Icons / validation',
    result: 'success',
    findings: [],
    ...overrides,
  }
}

const fix = { kind: 'fix' as const, title: 'A fix', body: 'Do this.' }
const automation = {
  kind: 'automation' as const,
  title: 'A crash',
  body: 'It broke.',
}

test('no comment when every job passed or was skipped', () => {
  assert.equal(renderComment([job({}), job({ result: 'skipped' })], '1'), null)
})

test('fix findings get their own section', () => {
  const comment = renderComment(
    [job({ result: 'failure', findings: [fix] })],
    '1',
  )
  assert.match(comment!, /1 thing needs your attention/)
  assert.match(comment!, /#### A fix/)
  assert.doesNotMatch(comment!, /automation had a problem/)
})

test('automation findings get an apology and the log link', () => {
  const comment = renderComment(
    [job({ result: 'failure', findings: [automation], logUrl: 'https://log' })],
    '1',
  )
  assert.match(comment!, /Sorry about that/)
  assert.match(comment!, /\[Open the log\]\(https:\/\/log\)/)
})

test('a failed job with no findings becomes an automation finding', () => {
  const [finding] = effectiveFindings(
    job({ result: 'failure', failedStep: 'Install dependencies' }),
  )
  assert.equal(finding.kind, 'automation')
  assert.match(finding.body, /Install dependencies/)
})

test('a failed job with no failed step says it stopped unexpectedly', () => {
  const [finding] = effectiveFindings(job({ result: 'failure' }))
  assert.match(finding.body, /stopped unexpectedly/)
})

test('a cancelled job is reported as an automation finding', () => {
  const [finding] = effectiveFindings(job({ result: 'cancelled' }))
  assert.equal(finding.kind, 'automation')
})

test('fix and automation findings share one comment', () => {
  const comment = renderComment(
    [
      job({ result: 'failure', findings: [fix] }),
      job({ id: 'categories', result: 'failure', findings: [automation] }),
    ],
    '1',
  )
  assert.match(comment!, /your attention/)
  assert.match(comment!, /automation had a problem/)
})

test('statuses', () => {
  assert.equal(statusFor(job({ result: 'skipped' })), null)
  assert.equal(statusFor(job({}))!.state, 'success')
  const failing = statusFor(job({ result: 'failure', findings: [fix] }))!
  assert.equal(failing.state, 'failure')
  assert.equal(failing.description, 'A fix')
  const long = statusFor(
    job({
      result: 'failure',
      findings: [{ ...fix, title: 'x'.repeat(200) }],
    }),
  )!
  assert.equal(long.description.length, 140)
})

test('the run id is read back from a comment', () => {
  const comment = renderComment(
    [job({ result: 'failure', findings: [fix] })],
    '4242',
  )
  assert.equal(recordedRunId(comment!), 4242)
  assert.equal(recordedRunId('no marker'), 0)
})

test('a truncated last line is ignored', () => {
  const text = `${JSON.stringify(fix)}\n{"kind":"fi`
  assert.deepEqual(parseFindings(text), [fix])
})
