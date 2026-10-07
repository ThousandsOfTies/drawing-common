const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/history/CanvasUndoHistory.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject, Uint32Array, Uint8ClampedArray })
const { CanvasUndoHistory } = exportsObject

function canvas(width = 64, height = 64) {
  const surface = { width, height, pixels: new Uint8ClampedArray(width * height * 4) }
  surface.getContext = () => ({
    getImageData: () => ({ width: surface.width, height: surface.height, data: surface.pixels.slice() }),
    putImageData: image => { surface.pixels.set(image.data) },
  })
  return surface
}
const bytes = surface => Array.from(surface.pixels)
const paint = (surface, offset, rgba) => surface.pixels.set(rgba, offset * 4)

test('strokes, partial transparency, erasing, clear and metadata undo exactly one operation at a time', () => {
  const surface = canvas(), history = new CanvasUndoHistory(), expected = []
  for (let i = 0; i < 12; i++) {
    const state = { texts: [`text-${i}`], strokes: [i] }
    expected.push({ pixels: bytes(surface), state })
    history.push(surface, state)
    if (i === 9) surface.pixels.fill(0) // clear a nonempty canvas
    else if (i === 7) paint(surface, 2, [0, 0, 0, 0]) // erase
    else if (i !== 4) paint(surface, i, [i * 17, 39, 120, i * 19]) // text-only at 4
  }
  while (expected.length) {
    const next = expected.pop()
    assert.equal(history.undo(surface).state, next.state)
    assert.deepEqual(bytes(surface), next.pixels)
    assert.equal(history.length, expected.length)
  }
  assert.equal(history.byteLength, 0)
  assert.equal(history.undo(surface), null)
})

test('a restored nonempty drawing is the first undo target; new drawing after undo branches correctly', () => {
  const surface = canvas(), history = new CanvasUndoHistory()
  paint(surface, 100, [230, 2, 71, 180])
  const restored = bytes(surface)
  history.push(surface, 'restored')
  paint(surface, 101, [32, 72, 145, 255])
  const first = bytes(surface)
  history.push(surface, 'first')
  surface.pixels.fill(0)
  assert.equal(history.undo(surface).state, 'first')
  assert.deepEqual(bytes(surface), first)
  history.push(surface, 'branch')
  paint(surface, 102, [44, 91, 12, 74])
  assert.equal(history.undo(surface).state, 'branch')
  assert.deepEqual(bytes(surface), first)
  assert.equal(history.undo(surface).state, 'restored')
  assert.deepEqual(bytes(surface), restored)
})

test('100 sparse strokes retain all undo steps with less than two full pixel buffers', () => {
  const surface = canvas(1000, 1400), history = new CanvasUndoHistory()
  for (let i = 0; i < 100; i++) {
    history.push(surface, i)
    paint(surface, i * 100, [20, 40, 60, 200])
  }
  assert.equal(history.length, 100)
  assert.ok(history.byteLength < surface.pixels.byteLength * 2)
  for (let i = 99; i >= 0; i--) {
    assert.equal(history.undo(surface).state, i)
    assert.equal(surface.pixels[i * 100 * 4 + 3], 0)
  }
})

test('dense pixel changes use a full reverse image without losing any bytes', () => {
  const surface = canvas(), history = new CanvasUndoHistory()
  history.push(surface, 'blank')
  for (let i = 0; i < surface.pixels.length; i += 8) surface.pixels.set([100, 50, 10, 75], i)
  const checker = bytes(surface)
  history.push(surface, 'checker')
  surface.pixels.fill(255)
  assert.equal(history.undo(surface).state, 'checker')
  assert.deepEqual(bytes(surface), checker)
  history.undo(surface)
  assert.ok(surface.pixels.every(value => value === 0))
})

test('resizing and changing the question release history from the old canvas', () => {
  const surface = canvas(), history = new CanvasUndoHistory()
  history.push(surface, 1)
  surface.width = 32
  surface.height = 32
  surface.pixels = new Uint8ClampedArray(32 * 32 * 4)
  assert.equal(history.undo(surface), null)
  assert.equal(history.byteLength, 0)
  history.push(surface, 2)
  history.clear()
  assert.equal(history.length, 0)
  assert.equal(history.byteLength, 0)
})
