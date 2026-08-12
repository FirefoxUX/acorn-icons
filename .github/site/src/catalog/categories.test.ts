import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  categoryFor,
  categoryLabel,
  categorySlug,
  knownCategories,
} from './categories.ts'

// These assert against the real icons/categories.json rather than a fixture,
// because the module reads it at import time. The icons named here are the
// ones the file deliberately splits by size, so they are the least likely to
// be recategorized on a whim.

test('an explicit size overrides the bare slug', () => {
  assert.equal(categoryFor('bookmark-fill', 12), 'badges')
  assert.equal(categoryFor('bookmark-fill', 16), 'bookmarks')
  assert.equal(categoryFor('soccer-ball', 32), 'sports')
  assert.equal(categoryFor('location', 20), 'location')
})

test('a bare slug covers every size that has no override', () => {
  assert.equal(categoryFor('soccer-ball', 12), 'profile')
  assert.equal(categoryFor('soccer-ball', 20), 'profile')
  // A size absent from the file still falls back rather than returning
  // undefined, which is what lets a new size ship without an edit.
  assert.equal(categoryFor('soccer-ball', 64), 'profile')
  assert.equal(categoryFor('location', 16), 'permissions')
})

test('the size is optional', () => {
  assert.equal(categoryFor('bookmark-fill'), 'bookmarks')
})

test('an icon with no entry has no category', () => {
  assert.equal(categoryFor('not-a-real-icon', 16), undefined)
  assert.equal(categoryFor('not-a-real-icon'), undefined)
})

test('categoryLabel prefers the label and otherwise capitalizes', () => {
  assert.equal(categoryLabel('alerts, notifications, help'), 'Alerts & help')
  assert.equal(categoryLabel('bookmarks'), 'Bookmarks')
  assert.equal(categoryLabel('not-a-real-category'), 'Not-a-real-category')
})

test('categorySlug is URL safe', () => {
  assert.equal(
    categorySlug('alerts, notifications, help'),
    'alerts-notifications-help',
  )
  assert.equal(categorySlug('tabs: audio & media'), 'tabs-audio-media')
})

test('knownCategories lists every declared category', () => {
  const known = knownCategories()
  assert.ok(known.includes('badges'))
  assert.ok(known.includes('bookmarks'))
  assert.equal(new Set(known).size, known.length)
})
