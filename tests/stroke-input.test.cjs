const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Run the input hook and drawing hook together, including their real refs,
// timestamps and stroke completion. Rendering can be deliberately withheld.
function harness(options = {}) {
  const cells = [], paths = [], captures = new Set(), modules = new Map()
  let cursor = 0, input
  const react = {
    useState(initial) {
      const index = cursor++
      cells[index] ??= { value: initial }
      return [cells[index].value, value => { cells[index].value = value }]
    },
    useRef(initial) { const index = cursor++; cells[index] ??= { current: initial }; return cells[index] },
    useEffect() {},
  }
  function load(name) {
    if (modules.has(name)) return modules.get(name)
    const exports = {}
    const filename = path.join(__dirname, '../src/hooks', name + '.ts')
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, performance: { now: () => 0 },
      requestAnimationFrame: () => 1, cancelAnimationFrame() {},
      require: id => { assert.equal(id, 'react'); return react },
    })
    modules.set(name, exports)
    return exports
  }
  const canvas = { current: { getSize: () => ({ width: 1000, height: 1000 }), drawStroke() {} } }
  const target = { setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id) }
  function render() {
    cursor = 0
    const drawing = load('useDrawing').useDrawing(canvas, { width: 2, color: '#123',
      onPathComplete: stroke => paths.push(JSON.parse(JSON.stringify(stroke))) })
    input = load('useStrokeInput').useStrokeInput({
      onStart: point => drawing.startDrawing(point.clientX, point.clientY, point.pressure, point.time),
      onMove: points => drawing.drawBatch(points.map(point => ({
        x: point.clientX, y: point.clientY, pressure: point.pressure, time: point.time,
      }))),
      onEnd: () => drawing.stopDrawing(), ...options,
    })
  }
  render()
  return { paths, captures, render, input: () => input,
    pointer(kind, values = {}) {
      const nativeEvent = { pointerId: 7, pointerType: 'pen', button: 0, buttons: kind === 'Up' ? 0 : 1,
        clientX: 10, clientY: 20, pressure: 0.5, timeStamp: 0, ...values }
      if (values.coalesced) nativeEvent.getCoalescedEvents = () => values.coalesced.map(point => ({ ...nativeEvent, ...point }))
      return input['onPointer' + kind]({ ...nativeEvent, nativeEvent, currentTarget: target, preventDefault() {} })
    },
    touch(kind, changed, touches = [], timeStamp = 0) {
      return input['onTouch' + kind]({ changedTouches: changed, touches, timeStamp, cancelable: true, preventDefault() {} })
    },
  }
}
const touch = (identifier, clientX = 10, clientY = 20, stylus = true) => ({
  identifier, clientX, clientY, touchType: stylus ? 'stylus' : 'direct', force: 0.5,
})

test('eight rapid taps all finish before any React render, including strokes without move events', () => {
  const app = harness()
  for (let index = 0; index < 8; index++) {
    const point = { clientX: 10 + index * 20, clientY: 20 + index * 20 }
    app.pointer('Down', { ...point, timeStamp: index * 3 })
    app.pointer('Up', { ...point, timeStamp: index * 3 + 1 })
  }
  assert.equal(app.paths.length, 8)
  assert.equal(app.captures.size, 0)
  assert.deepEqual(app.paths.map(stroke => stroke.points[0].x), Array.from({ length: 8 }, (_, index) => (10 + index * 20) / 1000))
})

test('a late up or cancel from a previous stroke cannot end the next stroke with the same pointer ID', () => {
  const app = harness()
  app.pointer('Down', { timeStamp: 0 })
  app.pointer('Up', { timeStamp: 1 })
  app.pointer('Down', { timeStamp: 3, clientX: 100 })
  assert.equal(app.pointer('Up', { timeStamp: 1 }), false)
  assert.equal(app.pointer('Cancel', { timeStamp: 1 }), false)
  app.pointer('Move', { timeStamp: 4, clientX: 110 })
  app.pointer('Up', { timeStamp: 5, clientX: 120 })
  assert.equal(app.paths.length, 2)
  assert.equal(app.paths[1].points.at(-1).x, 0.12)
})

test('clock-rounded pointer and Touch taps retain a drawable final sample', () => {
  const app = harness()
  for (let index = 0; index < 4; index++) {
    app.pointer('Down', { timeStamp: 10, clientX: 10 + index * 20 })
    app.pointer('Up', { timeStamp: 10, clientX: 10 + index * 20 })
  }
  for (let index = 0; index < 4; index++) {
    const point = touch(index, 100 + index * 20)
    app.touch('Start', [point], [point], 20)
    app.touch('End', [point], [], 20)
  }
  assert.equal(app.paths.length, 8)
  assert.ok(app.paths.every(stroke => stroke.points.length === 2))
})

test('a delayed pointer down cannot replay a stroke already completed by Touch fallback', () => {
  const app = harness()
  app.touch('Start', [touch(1)], [touch(1)], 0)
  app.touch('End', [touch(1, 30)], [], 2)
  assert.equal(app.pointer('Down', { timeStamp: 0 }), false)
  app.pointer('Up', { timeStamp: 2, clientX: 30 })
  assert.equal(app.paths.length, 1)
  app.pointer('Down', { timeStamp: 3, clientX: 100 })
  app.pointer('Up', { timeStamp: 4, clientX: 110 })
  assert.equal(app.paths.length, 2)
})

test('companion Pencil Touch events neither restart strokes nor let an old lifted touch stop a new one', () => {
  const app = harness()
  app.pointer('Down', { timeStamp: 0 })
  app.touch('Start', [touch(11)], [touch(11)], 0)
  app.pointer('Up', { timeStamp: 1 })
  app.pointer('Down', { timeStamp: 3, clientX: 100 })
  app.touch('Start', [touch(12, 100)], [touch(12, 100)], 3)
  app.touch('End', [touch(11)], [], 4)
  app.touch('Cancel', [touch(11)], [], 4)
  app.pointer('Move', { timeStamp: 5, clientX: 110 })
  app.pointer('Up', { timeStamp: 6, clientX: 120 })
  assert.equal(app.paths.length, 2)
  assert.equal(app.paths[1].points[0].x, 0.1)
  assert.equal(app.paths[1].points.at(-1).x, 0.12)
})

test('a matched companion Touch end finishes Pencil input when pointerup is missing', () => {
  const app = harness()
  app.pointer('Down', { timeStamp: 0 })
  app.touch('Start', [touch(11)], [touch(11)], 0)
  app.pointer('Move', { timeStamp: 1, clientX: 50 })
  app.touch('End', [touch(11, 60)], [], 2)
  app.pointer('Up', { timeStamp: 2, clientX: 60 })
  assert.equal(app.paths.length, 1)
  assert.equal(app.paths[0].points.at(-1).x, 0.06)
  assert.equal(app.captures.size, 0)
})

test('Touch-only Pencil fallback and finger drawing preserve input ownership', () => {
  const app = harness()
  app.touch('Start', [touch(1)], [touch(1)], 0)
  app.touch('End', [touch(2)], [touch(1)], 1)
  app.touch('Move', [touch(1, 30)], [touch(1, 30)], 2)
  app.touch('End', [touch(1, 40)], [], 3)
  app.touch('Start', [touch(3, 100, 100, false)], [touch(3, 100, 100, false)], 5)
  app.touch('End', [touch(3, 110, 110, false)], [], 6)
  assert.equal(app.paths.length, 2)
  assert.equal(app.paths[0].points.at(-1).x, 0.04)
  assert.equal(app.paths[1].points.at(-1).x, 0.11)
})

test('PDF finger gestures stay outside drawing, while Touch-only Pencil input is supported', () => {
  const app = harness({ touchDrawing: false })
  assert.equal(app.touch('Start', [touch(1, 10, 20, false)], [touch(1, 10, 20, false)], 0), false)
  app.touch('Start', [touch(2)], [touch(2)], 1)
  app.touch('End', [touch(2, 30)], [], 2)
  assert.equal(app.paths.length, 1)
})

test('returning to the same endpoint retains distinct samples, while partial coalesced replays create no chord', () => {
  const app = harness()
  const first = [
    { clientX: 50, clientY: 20, timeStamp: 1 },
    { clientX: 50, clientY: 50, timeStamp: 2 },
    { clientX: 10, clientY: 50, timeStamp: 3 },
  ]
  app.pointer('Down', { timeStamp: 0 })
  app.pointer('Move', { timeStamp: 3, coalesced: first })
  app.pointer('Move', { timeStamp: 4, coalesced: [...first, { clientX: 10, clientY: 80, timeStamp: 4 }] })
  app.pointer('Move', { timeStamp: 6, coalesced: [
    { clientX: 30, clientY: 80, timeStamp: 5 }, { clientX: 10, clientY: 80, timeStamp: 6 },
  ] })
  app.pointer('Up', { timeStamp: 6, clientX: 10, clientY: 80 })
  assert.deepEqual(app.paths[0].points.map(({ x, y }) => [x, y]), [
    [0.01, 0.02], [0.05, 0.02], [0.05, 0.05], [0.01, 0.05], [0.01, 0.08], [0.03, 0.08], [0.01, 0.08],
  ])
})

test('empty coalesced events fall back to the native event and unrelated pointers cannot end a stroke', () => {
  const app = harness()
  app.pointer('Down', { timeStamp: 0 })
  app.pointer('Move', { timeStamp: 1, clientX: 50, coalesced: [] })
  app.pointer('Up', { timeStamp: 2, pointerId: 8 })
  app.pointer('Up', { timeStamp: 2, clientX: 60 })
  app.pointer('Up', { timeStamp: 2, clientX: 60 })
  assert.equal(app.paths.length, 1)
  assert.deepEqual(app.paths[0].points.map(point => point.x), [0.01, 0.05, 0.06])
})

test('a new down after a missing up separates strokes instead of joining their endpoints', () => {
  const app = harness()
  app.pointer('Down', { timeStamp: 0 })
  app.pointer('Move', { timeStamp: 1, clientX: 20 })
  app.pointer('Down', { timeStamp: 2, clientX: 100 })
  app.pointer('Up', { timeStamp: 3, clientX: 110 })
  assert.equal(app.paths.length, 2)
  assert.equal(app.paths[0].points.at(-1).x, 0.02)
  assert.equal(app.paths[1].points[0].x, 0.1)
})
