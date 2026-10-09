const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const plain = value => JSON.parse(JSON.stringify(value))

// Exercise the JSX-wired Pointer handlers with the real drawing and eraser
// hooks. Keep React state/refs across renders, and replace only the DOM/paint.
function harness(overrides = {}) {
  let cursor = 0, now = 1000, props, canvasProps
  const cells = [], added = [], changes = [], captures = new Set(), modules = new Map()
  const react = {
    useRef(initial) { const index = cursor++; cells[index] ??= { current: initial }; return cells[index] },
    useState(initial) {
      const index = cursor++
      cells[index] ??= {
        value: typeof initial === 'function' ? initial() : initial,
        setter(value) { cells[index].value = typeof value === 'function' ? value(cells[index].value) : value },
      }
      return [cells[index].value, cells[index].setter]
    },
    useEffect() {},
    useImperativeHandle(ref, create) { if (ref) ref.current = create() },
    forwardRef: render => render,
  }
  react.default = react
  react.__esModule = true
  const runtime = {
    Fragment: Symbol('Fragment'),
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
  }
  const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {} }
  const canvas = {
    width: 1000, height: 500,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 500, height: 250 }),
    getContext: () => ctx,
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id),
  }
  function load(relative) {
    const filename = path.resolve(__dirname, '../src', relative)
    if (modules.has(filename)) return modules.get(filename)
    const exports = {}
    modules.set(filename, exports)
    const source = fs.readFileSync(filename, 'utf8')
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    vm.runInNewContext(code, {
      exports, Date: { now: () => now }, performance: { now: () => now },
      require(id) {
        if (id === 'react') return react
        if (id === 'react/jsx-runtime') return runtime
        if (id === '../hooks/useDrawing') return load('hooks/useDrawing.ts')
        if (id === '../hooks/useStrokeInput') return load('hooks/useStrokeInput.ts')
        if (id === '../diagnostics/strokeInputDiagnostics') return load('diagnostics/strokeInputDiagnostics.ts')
        if (id === '../hooks/useEraser') return load('hooks/useEraser.ts')
        if (id === '../rendering/drawAdditionalStrokeStyle') return { drawAdditionalStrokeStyle: () => false }
        if (id === '../rendering/drawStationaryStroke') return load('rendering/drawStationaryStroke.ts')
        throw new Error('Unexpected dependency: ' + id)
      },
    }, { filename })
    return exports
  }
  const { DrawingCanvas } = load('components/DrawingCanvas.tsx')
  props = {
    tool: 'pen', color: '#123456', size: 10, eraserSize: 15, paths: [],
    onPathAdd: value => added.push(plain(value)),
    onPathsChange: value => { changes.push(plain(value)); props.paths = value },
    ...overrides,
  }
  function render(update = {}) {
    Object.assign(props, update)
    cursor = 0
    const tree = DrawingCanvas(props, { current: null })
    canvasProps = tree.props.children[0].props
    canvasProps.ref.current = canvas
  }
  render()
  return {
    added, changes, captures,
    render,
    advance(ms) { now += ms },
    pointer(kind, options = {}) {
      const nativeEvent = {
        pointerId: 1, pointerType: 'pen', clientX: 110, clientY: 70,
        pressure: 0.5, timeStamp: now, button: 0, buttons: kind === 'Up' ? 0 : 1,
        ...options,
      }
      if (options.coalesced) nativeEvent.getCoalescedEvents = () => options.coalesced.map(point => ({ ...nativeEvent, ...point }))
      canvasProps['onPointer' + kind]({ ...nativeEvent, nativeEvent, currentTarget: canvas, preventDefault() {} })
      if (options.renderAfter !== false) render()
    },
  }
}

for (const pointerType of ['pen', 'mouse', 'touch']) {
  test(`${pointerType} completes a stroke at normalized canvas coordinates`, () => {
    const app = harness()
    app.pointer('Down', { pointerType })
    assert.equal(app.captures.has(1), true)
    app.pointer('Move', { pointerType, clientX: 210, clientY: 120 })
    app.pointer('Up', { pointerType })
    assert.equal(app.captures.size, 0)
    assert.equal(app.added.length, 1)
    assert.deepEqual(app.added[0].points.map(({ x, y }) => ({ x, y })), [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }])
    assert.equal(app.added[0].color, '#123456')
  })
}

test('the JSX input handlers retain eight consecutive taps less than 50ms apart without a render', () => {
  const app = harness()
  for (let index = 0; index < 8; index++) {
    const point = { clientX: 110 + index * 20, clientY: 70 + index * 5, renderAfter: false }
    app.pointer('Down', point)
    app.advance(1)
    app.pointer('Up', point)
    app.advance(1)
  }
  assert.equal(app.added.length, 8)
  assert.equal(app.captures.size, 0)
})

test('coalesced pen points retain pressure-dependent brush width', () => {
  const stroke = (pointerType, pressure) => {
    const app = harness({ strokeStyle: 'brush' })
    app.pointer('Down', { pointerType })
    app.pointer('Move', { pointerType, coalesced: [
      { clientX: 160, clientY: 70, timeStamp: 1010, pressure },
      { clientX: 210, clientY: 70, timeStamp: 1020, pressure },
      { clientX: 260, clientY: 70, timeStamp: 1030, pressure },
      { clientX: 310, clientY: 70, timeStamp: 1040, pressure },
    ] })
    app.pointer('Up', { pointerType })
    return app.added[0]
  }
  const light = stroke('pen', 0.2), heavy = stroke('pen', 0.8)
  assert.equal(heavy.points.length, 5)
  assert.deepEqual(heavy.points.map(point => point.x), [0.2, 0.3, 0.4, 0.5, 0.6])
  assert.ok(heavy.points[2].width > light.points[2].width)
  assert.deepEqual(stroke('mouse', 0.2), stroke('mouse', 0.8), 'mouse pressure must not act as pen pressure')
})

test('the JSX wrapper accepts a new Pencil ID after a missing up and keeps the strokes separate', () => {
  const app = harness()
  app.pointer('Down', { pointerId: 7, renderAfter: false })
  app.advance(1)
  app.pointer('Move', { pointerId: 7, clientX: 160, renderAfter: false })
  app.advance(1)
  app.pointer('Down', { pointerId: 8, clientX: 310, renderAfter: false })
  app.advance(1)
  app.pointer('Move', { pointerId: 8, clientX: 360, renderAfter: false })
  app.pointer('Up', { pointerId: 7, clientX: 160, renderAfter: false })
  app.pointer('Up', { pointerId: 8, clientX: 360, renderAfter: false })
  assert.equal(app.added.length, 2)
  assert.deepEqual(app.added.map(stroke => stroke.points.map(point => point.x)), [[0.2, 0.3], [0.6, 0.7]])
  assert.equal(app.captures.size, 0)
})

test('an unrelated pointer cannot move or end the active stroke', () => {
  const app = harness()
  app.pointer('Down')
  app.pointer('Move', { pointerId: 2, clientX: 310 })
  app.pointer('Up', { pointerId: 2 })
  assert.equal(app.added.length, 0)
  assert.equal(app.captures.has(1), true)
  app.pointer('Move', { clientX: 210 })
  app.pointer('Up')
  assert.equal(app.added[0].points.length, 2)
})

test('stylus-only drawing rejects mouse/fingers while preserving two-finger Undo', () => {
  let undoCount = 0
  const app = harness({ stylusOnly: true, onUndo: () => undoCount++ })
  app.pointer('Down', { pointerType: 'mouse' })
  app.pointer('Up', { pointerType: 'mouse' })
  app.pointer('Down', { pointerType: 'touch', pointerId: 2 })
  app.pointer('Down', { pointerType: 'touch', pointerId: 3 })
  app.pointer('Up', { pointerType: 'touch', pointerId: 2 })
  app.pointer('Up', { pointerType: 'touch', pointerId: 3 })
  assert.equal(undoCount, 1)
  assert.equal(app.added.length, 0)
  assert.equal(app.captures.size, 0)
  app.pointer('Down')
  app.pointer('Up')
  assert.equal(app.added.length, 1)
})

test('the pointer eraser removes only the stroke under its tip', () => {
  const nearby = { points: [{ x: 0.2, y: 0.2 }, { x: 0.201, y: 0.201 }], color: '#000000', width: 3 }
  const distant = { points: [{ x: 0.8, y: 0.8 }, { x: 0.9, y: 0.9 }], color: '#000000', width: 3 }
  const app = harness({ tool: 'eraser', paths: [nearby, distant] })
  app.pointer('Down')
  app.pointer('Move', { clientX: 210 })
  app.pointer('Up')
  assert.deepEqual(app.changes, [[distant]])
  assert.equal(app.added.length, 0)
  assert.equal(app.captures.size, 0)
})

test('selection uses normalized drag points and clears when tapped outside', () => {
  const events = []
  const selectionState = { selectedIndices: [0], boundingBox: { minX: 0.1, minY: 0.1, maxX: 0.5, maxY: 0.5 }, isDragging: false }
  const app = harness({
    selectionState,
    onSelectionDragStart: point => events.push(['start', plain(point)]),
    onSelectionDrag: point => events.push(['move', plain(point)]),
    onSelectionDragEnd: () => events.push(['end']),
    onSelectionClear: () => events.push(['clear']),
  })
  app.pointer('Down')
  app.render({ selectionState: { ...selectionState, isDragging: true } })
  app.pointer('Move', { clientX: 210, clientY: 120 })
  app.pointer('Up')
  assert.deepEqual(events, [['start', { x: 0.2, y: 0.2 }], ['move', { x: 0.4, y: 0.4 }], ['end']])
  app.render({ selectionState })
  app.pointer('Down', { clientX: 460, clientY: 220 })
  app.pointer('Up')
  assert.deepEqual(events.at(-1), ['clear'])
  assert.equal(app.added.length, 0)
})

test('pointer cancellation releases capture and permits the next stroke', () => {
  const app = harness()
  app.pointer('Down')
  app.pointer('Move', { clientX: 210 })
  app.pointer('Cancel')
  assert.equal(app.captures.size, 0)
  assert.equal(app.added.length, 1)
  app.advance(100)
  app.pointer('Down', { pointerId: 2 })
  app.pointer('Up', { pointerId: 2 })
  assert.equal(app.added.length, 2)
})

test('display-only canvas does not add strokes', () => {
  const app = harness({ interactionMode: 'display-only' })
  app.pointer('Down')
  app.pointer('Move', { clientX: 210 })
  app.pointer('Up')
  assert.equal(app.added.length, 0)
})
