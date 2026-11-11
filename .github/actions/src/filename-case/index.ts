import fg from 'fast-glob'
import path from 'node:path'
import { summary } from '../summary.js'
import { recordFindings, tryCatch } from '../utils.js'

async function run() {
  const files = await fg(['icons/**/*', 'illustrations/**/*'], {
    onlyFiles: true,
    dot: false,
  })

  const byKey = new Map<string, string[]>()
  for (const file of files) {
    const key = path.join(path.dirname(file), path.basename(file).toLowerCase())
    byKey.set(key, [...(byKey.get(key) ?? []), file])
  }
  const collisions = [...byKey.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort())
    .sort()

  summary.addHeading(`Checked ${files.length} filenames`, 3)

  if (collisions.length === 0) {
    summary.addRaw('No filenames collide when letter case is ignored.')
    summary.addEOL()
    await summary.write()
    return
  }

  summary.addAlert(
    'caution',
    `${collisions.length} group${collisions.length === 1 ? '' : 's'} of filenames differ only by letter case.`,
  )
  summary.addList(collisions.map((group) => `<code>${group.join(', ')}</code>`))

  const count = collisions.length
  recordFindings([
    {
      kind: 'fix',
      title:
        count === 1
          ? '1 filename collides on case-insensitive filesystems'
          : `${count} filenames collide on case-insensitive filesystems`,
      body: [
        collisions
          .map((group) => group.map((file) => `- \`${file}\``).join('\n'))
          .join('\n\n'),
        '',
        'Rename all but one file in each group so the names differ in something other than letter case. macOS and Windows treat each group as a single file.',
      ].join('\n'),
    },
  ])

  await summary.write()
}

tryCatch(run, 'Failed to check filenames. See logs for details.')
