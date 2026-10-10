const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function canvas(parentElement) {
  const stack = [], strokes = [], images = [], clips = []
  let commands = [], transform = { x: 0, y: 0 }
  const element = { width: 300, height: 150, parentElement, style: {}, getContext: () => ctx }
  const ctx = { canvas: element, strokes, images, clips, globalAlpha: 1,
    save() { stack.push({ transform: { ...transform }, globalAlpha: this.globalAlpha, strokeStyle: this.strokeStyle }) },
    restore() { const state = stack.pop(); transform = state.transform; Object.assign(this, state) },
    setTransform() { transform = { x: 0, y: 0 } },
    translate(x, y) { transform.x += x; transform.y += y },
    clearRect() { strokes.length = 0; images.length = 0; clips.length = 0 },
    beginPath() { commands = [] },
    moveTo(x, y) { commands.push(['move', x + transform.x, y + transform.y]) },
    lineTo(x, y) { commands.push(['line', x + transform.x, y + transform.y]) },
    quadraticCurveTo(cx, cy, x, y) { commands.push(['curve', cx + transform.x, cy + transform.y, x + transform.x, y + transform.y]) },
    arc(x, y, radius) { commands.push(['dot', x + transform.x, y + transform.y, radius]) },
    rect(...args) { clips.push(args) }, clip() {}, closePath() {}, setLineDash() {},
    stroke() { strokes.push({ width: this.lineWidth, alpha: this.globalAlpha, color: this.strokeStyle, commands: [...commands] }) },
    fill() { strokes.push({ alpha: this.globalAlpha, commands: [...commands] }) },
    drawImage(...args) { images.push({ args, alpha: this.globalAlpha }) },
  }
  return element
}

function harness(overrides = {}) {
  let cursor = 0, dirty = false, observerDisconnected = false
  const cells = [], layouts = [], effects = [], layers = [], modules = new Map()
  const container = { clientWidth: 400, clientHeight: 300 }
  const saved = canvas(container), preview = canvas(container), raster = canvas()
  const react = {
    useRef(value) { const i = cursor++; return cells[i] ??= { current: value } },
    useState(value) { const i = cursor++; cells[i] ??= { value }; return [cells[i].value, next => {
      const updated = typeof next === 'function' ? next(cells[i].value) : next
      dirty ||= updated !== cells[i].value; cells[i].value = updated
    }] },
    useEffect: (callback, dependencies) => enqueue(effects, callback, dependencies),
    useLayoutEffect: (callback, dependencies) => enqueue(layouts, callback, dependencies),
  }
  react.default = react; react.__esModule = true
  function enqueue(queue, callback, dependencies) {
    const i = cursor++, previous = cells[i]
    if (previous && dependencies.every((value, index) => Object.is(value, previous.dependencies[index]))) return
    previous?.cleanup?.(); cells[i] = { dependencies }
    queue.push(() => { cells[i].cleanup = callback() })
  }
  const runtime = { Fragment: Symbol('Fragment'), jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  function load(relative) {
    const filename = path.resolve(__dirname, '../src', relative)
    if (modules.has(filename)) return modules.get(filename)
    const exports = {}; modules.set(filename, exports)
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, window: { devicePixelRatio: 2 },
      ResizeObserver: class { observe() {} disconnect() { observerDisconnected = true } },
      document: { createElement() { const layer = canvas(); layers.push(layer); return layer } },
      require(id) {
        if (id === 'react') return react
        if (id === 'react/jsx-runtime') return runtime
        return load(path.relative(path.resolve(__dirname, '../src'), path.resolve(path.dirname(filename), id + '.ts')))
      },
    })
    return exports
  }
  const { DrawingViewport } = load('components/DrawingViewport.tsx')
  const { drawDrawingPath } = load('rendering/drawDrawingPath.ts')
  const stroke = { color: '#123456', width: 3, style: 'pencil', points: [{ x: 0.2, y: 0.3 }, { x: 0.22, y: 0.34 }] }
  let props = { paper: { width: 600, height: 800 }, zoom: 1, offset: { x: 0, y: 0 },
    paths: [stroke], previewPath: null, navigating: false, getRasterCanvas: () => raster, ...overrides }
  let tree
  function render(next = {}) {
    props = { ...props, ...next }
    do {
      dirty = false; cursor = 0
      tree = DrawingViewport(props)
      tree.props.children[0].props.ref.current = saved
      tree.props.children[1].props.ref.current = preview
      layouts.splice(0).forEach(run => run()); effects.splice(0).forEach(run => run())
    } while (dirty)
  }
  render()
  return { saved, preview, raster, stroke, layers, render, drawDrawingPath,
    get tree() { return tree },
    unmount() { cells.forEach(cell => cell.cleanup?.()); return observerDisconnected },
  }
}

test('zoom redraws live and saved ink in Retina viewport pixels without enlarging its bitmap', () => {
  const app = harness()
  assert.equal(app.saved.width, 800); assert.equal(app.saved.height, 600)
  app.render({ zoom: 4, offset: { x: -320, y: -800 }, previewPath: app.stroke })
  assert.equal(app.saved.width, 800); assert.equal(app.saved.height, 600)
  const saved = app.saved.getContext().strokes[0], preview = app.preview.getContext().strokes[0]
  assert.equal(saved.width, 24, '3 logical units × zoom 4 × screen density 2')
  assert.deepEqual(saved, preview)
  assert.deepEqual(saved.commands[0], ['move', 320, 320])
  assert.equal(app.saved.getContext().images.length, 0, 'settled ink is drawn from paths instead of a scaled page image')
  assert.deepEqual(Array.from(app.saved.getContext().clips[0]), [-640, -1600, 4800, 6400])
})

test('pinch and pan retain a fast raster preview, then repaint native strokes when navigation ends', () => {
  const app = harness()
  app.render({ zoom: 4, offset: { x: -320, y: -800 }, navigating: true })
  assert.equal(app.saved.getContext().images[0].args[0], app.raster)
  assert.equal(app.saved.getContext().strokes.length, 0)
  app.render({ navigating: false })
  assert.equal(app.saved.getContext().images.length, 0)
  assert.equal(app.saved.getContext().strokes[0].width, 24)
})

test('fill masks preserve whole-paper topology, while a new pen preview uses native display pixels', () => {
  const app = harness()
  const fill = { kind: 'fill', color: '#ff0000', width: 0, points: [{ x: 0.1, y: 0.1 }] }
  app.render({ paths: [app.stroke, fill], previewPath: app.stroke })
  assert.equal(app.saved.getContext().images[0].args[0], app.raster)
  assert.equal(app.preview.getContext().strokes[0].width, 6)
})

test('translucent brush segments composite once and allocate only their visible rectangle', () => {
  const app = harness(), ctx = app.saved.getContext()
  ctx.clearRect()
  app.drawDrawingPath(ctx, { color: '#123456', width: 4, opacity: 0.3, style: 'brush',
    points: [{ x: -100, y: 0.25 }, { x: 0.5, y: 0.3 }, { x: 100, y: 0.25 }] },
    { scaleX: 800, scaleY: 600, widthScale: 8 }, { layer: { current: null } })
  assert.equal(ctx.images.length, 1); assert.equal(ctx.images[0].alpha, 0.3)
  const layer = app.layers.at(-1)
  assert.ok(layer.width <= 800 && layer.height <= 600)
  assert.ok(layer.getContext().strokes.every(stroke => stroke.alpha === 1))
})

test('a refined paper bitmap refreshes settled fill masks without resizing the visible drawing surface', () => {
  const app = harness()
  let reads = 0
  const getRasterCanvas = () => { reads++; return app.raster }
  const paths = [app.stroke, { kind: 'fill', color: '#ff0000', width: 0, points: [{ x: 0.1, y: 0.1 }] }]
  app.render({ paths, getRasterCanvas, rasterSize: { width: 600, height: 800 } })
  app.render({ rasterSize: { width: 1800, height: 2400 } })
  assert.equal(reads, 2)
  assert.equal(app.saved.width, 800); assert.equal(app.saved.height, 600)
})

test('off-screen paths allocate no transparency layer and the display surface owns no input handlers', () => {
  const app = harness(), ctx = app.saved.getContext()
  ctx.clearRect()
  app.drawDrawingPath(ctx, { ...app.stroke, opacity: 0.3 },
    { scaleX: 4800, scaleY: 6400, widthScale: 8, offsetX: -9000, offsetY: -9000 })
  assert.equal(app.layers.length, 0); assert.equal(ctx.images.length, 0); assert.equal(ctx.strokes.length, 0)
  for (const node of app.tree.props.children) {
    assert.equal(node.props.style.pointerEvents, 'none')
    assert.equal(node.props.onPointerDown, undefined)
  }
  assert.equal(app.unmount(), true)
})
