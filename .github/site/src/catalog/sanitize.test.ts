import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readDimensions, sanitizeSvg } from './sanitize.ts'

test('readDimensions prefers the viewBox over width and height', () => {
  // extension-critical-16.svg is named 16 and lives in the 16 folder, but draws
  // at 20.
  const svg =
    '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M0 0"/></svg>'
  assert.deepEqual(readDimensions(svg), { width: 20, height: 20 })
})

test('readDimensions falls back to width and height', () => {
  const svg = '<svg width="433" height="264"><path d="M0 0"/></svg>'
  assert.deepEqual(readDimensions(svg), { width: 433, height: 264 })
})

test('readDimensions reads a comma-separated viewBox', () => {
  assert.deepEqual(readDimensions('<svg viewBox="0,0,300,301"></svg>'), {
    width: 300,
    height: 301,
  })
})

test('sanitizeSvg converts the desktop context paints', () => {
  const source = `<!-- This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. -->
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="context-fill" fill-opacity="context-fill-opacity" viewBox="0 0 16 16">
    <path fill-rule="evenodd" d="M6.465 1.48z" clip-rule="evenodd" />
</svg>`
  const out = sanitizeSvg(source, 'icon-desktop-16-bookmark')

  assert.match(out, /^<svg /)
  assert.match(out, /fill="currentColor"/)
  assert.doesNotMatch(out, /context-fill/)
  assert.doesNotMatch(out, /width="16"/)
  assert.match(out, /viewBox="0 0 16 16"/)
  assert.match(out, /aria-hidden="true"/)
  assert.match(out, /focusable="false"/)
})

test('sanitizeSvg keeps the two duotone channels distinct', () => {
  const source = `<svg viewBox="0 0 16 16" fill-opacity="context-fill-opacity">
    <path fill="context-fill" d="M5.5 4.44z" />
    <path fill="context-stroke" d="M.22.22z" />
</svg>`
  const out = sanitizeSvg(source, 'icon-desktop-16-lock-slash-duotone')

  assert.match(out, /fill="currentColor"/)
  assert.match(out, /fill="var\(--asset-fill-2\)"/)
})

test('sanitizeSvg drops both context opacity spellings', () => {
  const out = sanitizeSvg(
    '<svg viewBox="0 0 12 12" fill-opacity="context-fill-opacity" stroke-opacity="context-stroke-opacity"><path d="M0 0"/></svg>',
    'x',
  )
  assert.doesNotMatch(out, /context-/)
})

test('sanitizeSvg handles context paints on the stroke attribute', () => {
  const out = sanitizeSvg(
    '<svg viewBox="0 0 16 16"><path stroke="context-fill" d="M0 0"/></svg>',
    'x',
  )
  assert.match(out, /stroke="currentColor"/)
})

test('sanitizeSvg recolors mobile black but keeps the multicolor fills', () => {
  const source = `<svg width="24" height="24" fill="none" viewBox="0 0 24 24">
    <path fill="#000" d="M8 6z" />
    <path fill="#c52d4f" d="M2 2z" />
    <path fill="#fff" d="M1 1z" />
</svg>`
  const out = sanitizeSvg(source, 'icon-mobile-24-shield-slash-multicolor')

  assert.match(out, /fill="currentColor"/)
  assert.match(out, /fill="#c52d4f"/)
  assert.match(out, /fill="#fff"/)
})

test('sanitizeSvg strips the XML declaration and doctype', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>`
  const out = sanitizeSvg(source, 'x')

  assert.ok(out.startsWith('<svg'), out.slice(0, 40))
  assert.doesNotMatch(out, /DOCTYPE/)
  assert.doesNotMatch(out, /<\?xml/)
})

test('sanitizeSvg namespaces ids in every reference form', () => {
  const source = `<svg viewBox="0 0 10 10">
    <path fill="url(#b)" clip-path="url('#a')" d="M0 0"/>
    <use href="#c" />
    <use xlink:href="#d" />
    <defs>
      <linearGradient id="b"><stop stop-color="#fff"/></linearGradient>
      <clipPath id="a"><path d="M0 0h10v10H0z"/></clipPath>
      <path id="c" d="M0 0"/>
      <path id="d" d="M0 0"/>
    </defs>
</svg>`
  const out = sanitizeSvg(source, 'illustration-pictograms-pic-shield')

  assert.match(out, /url\(#illustration-pictograms-pic-shield-b\)/)
  assert.match(out, /url\('#illustration-pictograms-pic-shield-a'\)/)
  assert.match(out, /id="illustration-pictograms-pic-shield-b"/)
  assert.match(out, /href="#illustration-pictograms-pic-shield-c"/)
  assert.match(out, /xlink:href="#illustration-pictograms-pic-shield-d"/)
  // No bare single-letter reference may survive, or two assets on one page
  // would share a gradient.
  assert.doesNotMatch(out, /url\(['"]?#[a-zA-Z]['"]?\)/)
})

test('sanitizeSvg synthesizes a viewBox when only width and height exist', () => {
  const out = sanitizeSvg(
    '<svg width="30" height="30"><path d="M0 0"/></svg>',
    'x',
  )

  assert.match(out, /viewBox="0 0 30 30"/)
  assert.doesNotMatch(out, /width="30"/)
})
