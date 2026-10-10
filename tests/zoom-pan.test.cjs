const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

class Surface {
  constructor(parent = null) { this.parent = parent; this.listeners = new Map() }
  contains(target) {
    for (let node = target; node; node = node.parent) if (node === this) return true
    return false
  }
  addEventListener(type, listener, options) {
    if (type === 'wheel') assert.equal(options.passive, false)
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(listener)
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }
  dispatch(type, event) {
    for (let node = this; node; node = node.parent) {
      for (const listener of [...(node.listeners.get(type) ?? [])]) listener(event)
      if (event.propagationStopped) break
    }
  }
}

// Run the actual hook with React's persistent state/effect semantics and a DOM
// event tree. In particular, the selection overlay is a sibling of the pane.
function harness({ width = 1200, height = 1000, pageWidth = 600, pageHeight = 800, left = 0, shared = false } = {}) {
  let cursor = 0, effects = [], result
  const cells = []
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const react = {
    useState(initial) {
      const index = cursor++
      cells[index] ??= {
        value: initial,
        setter(value) { cells[index].value = typeof value === 'function' ? value(cells[index].value) : value },
      }
      return [cells[index].value, cells[index].setter]
    },
    useRef(value) { const index = cursor++; cells[index] ??= { current: value }; return cells[index] },
    useCallback(callback, deps) {
      const index = cursor++
      if (!same(cells[index]?.deps, deps)) cells[index] = { callback, deps }
      return cells[index].callback
    },
    useEffect(callback, deps) {
      const index = cursor++
      if (!same(cells[index]?.deps, deps)) effects.push(() => {
        cells[index]?.cleanup?.()
        cells[index] = { deps, cleanup: callback() }
      })
    },
  }
  const document = new Surface(), window = new Surface()
  const surface = new Surface(document)
  const pane = Object.assign(new Surface(surface), {
    clientWidth: width, clientHeight: height,
    getBoundingClientRect: () => ({ left, right: left + width, top: 50, bottom: 50 + height, width, height }),
  })
  const canvas = Object.assign(new Surface(pane), {
    clientWidth: pageWidth, clientHeight: pageHeight, width: pageWidth * 2, height: pageHeight * 2,
  })
  const overlay = new Surface(surface), outside = new Surface(document)
  const containerRef = { current: pane }, canvasRef = { current: canvas }, eventTargetRef = { current: surface }
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/hooks/useZoomPan.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: id => { assert.equal(id, 'react'); return react }, document, window })
  function render() {
    cursor = 0
    result = exports.useZoomPan(containerRef, 0.1, undefined, canvasRef, shared ? { wheelEventTargetRef: eventTargetRef } : undefined)
    for (const effect of effects.splice(0)) effect()
    return result
  }
  render()
  return {
    pane, canvas, surface, document,
    view: () => render(),
    fit() { result.fitToScreen(pageWidth, pageHeight); return render() },
    wheel(deltaY, { target = 'canvas', ctrlKey = true, metaKey = false, deltaX = 0, clientX = left + width / 2, clientY = 50 + height / 2, renderAfter = true } = {}) {
      const event = {
        target: { canvas, overlay, outside, pane }[target], deltaY, deltaX, clientX, clientY, ctrlKey, metaKey,
        defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true },
        stopPropagation() { this.propagationStopped = true },
      }
      event.target.dispatch('wheel', event)
      if (renderAfter) render()
      return event
    },
    dispose() { for (const cell of cells) cell?.cleanup?.() },
  }
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)

test('Ctrl-wheel stops at the fitted page size and can zoom in again', () => {
  const app = harness()
  const initial = app.fit().zoom
  const event = app.wheel(100)
  assert.equal(event.defaultPrevented, true)
  near(app.view().zoom, initial)
  app.wheel(-100)
  assert.ok(app.view().zoom > initial)
  app.wheel(100)
  near(app.view().zoom, initial)
})

test('zoom remains reversible after the paper reaches and exceeds the viewport', () => {
  const app = harness()
  const initial = app.fit().zoom
  for (let step = 0; step < 12; step++) app.wheel(-100)
  assert.ok(app.view().zoom > 2, 'the former 200% wheel ceiling must not block the available zoom range')
  for (let step = 0; step < 12; step++) app.wheel(100)
  near(app.view().zoom, initial)
})

test('a physically small PDF does not raise the minimum above the maximum', () => {
  const app = harness({ pageWidth: 60, pageHeight: 80 })
  const initial = app.fit().zoom
  app.wheel(100)
  near(app.view().zoom, initial)
  app.wheel(-100)
  assert.ok(app.view().zoom > initial)
  app.wheel(100)
  near(app.view().zoom, initial)
})

test('zoom-out and zoom-in remain available at both wheel limits', () => {
  const app = harness()
  const minimum = app.fit().zoom
  for (let step = 0; step < 60; step++) app.wheel(-100)
  near(app.view().zoom, 5)
  app.wheel(100)
  assert.ok(app.view().zoom < 5)
  for (let step = 0; step < 60; step++) app.wheel(100)
  near(app.view().zoom, minimum)
  app.wheel(-100)
  assert.ok(app.view().zoom > minimum)
})

test('wheel, pinch and programmatic zoom share a fit limit independent of bitmap resolution', () => {
  const app = harness({ width: 520, height: 380 })
  const minimum = app.fit().zoom
  near(minimum, 0.45)
  for (let gesture = 0; gesture < 20; gesture++) {
    app.view().setZoom(app.view().clampZoom(0.001))
    near(app.view().zoom, minimum)
    app.wheel(100)
    near(app.view().zoom, minimum)
  }
  app.canvas.width *= 4; app.canvas.height *= 4
  near(app.view().getMinimumZoom(), minimum)
  near(app.view().clampZoom(0.001), minimum)
  app.wheel(-100)
  assert.ok(app.view().zoom > minimum)
})

test('a larger viewport does not turn zoom-out into enlargement', () => {
  const app = harness()
  const initial = app.fit().zoom
  app.pane.clientHeight = 1600
  assert.ok(app.view().getFitToScreenZoom() > initial)
  app.wheel(100)
  near(app.view().zoom, initial)
  app.wheel(-100)
  assert.ok(app.view().zoom > initial)
})

test('a shared selection overlay routes Ctrl-wheel only to the pane under the cursor', () => {
  const app = harness({ width: 600, shared: true })
  const initial = app.fit().zoom
  assert.equal(app.wheel(-100, { target: 'overlay' }).defaultPrevented, true)
  assert.ok(app.view().zoom > initial)
  const current = app.view().zoom
  assert.equal(app.wheel(-100, { target: 'overlay', clientX: 900 }).defaultPrevented, false)
  near(app.view().zoom, current)
  assert.equal(app.wheel(-100, { target: 'outside' }).defaultPrevented, false)
  near(app.view().zoom, current)
})

test('rapid wheel events accumulate before the next React render', () => {
  const app = harness()
  const initial = app.fit().zoom
  for (let step = 0; step < 4; step++) app.wheel(-100, { renderAfter: false })
  near(app.view().zoom, initial + 0.4)
  for (let step = 0; step < 4; step++) app.wheel(100, { renderAfter: false })
  near(app.view().zoom, initial)
})

test('wheel zoom preserves the content point under the cursor', () => {
  const app = harness()
  app.fit()
  for (let step = 0; step < 12; step++) app.wheel(-100)
  const before = app.view()
  const contentX = (600 - before.panOffset.x) / before.zoom
  const contentY = (500 - before.panOffset.y) / before.zoom
  app.wheel(-100)
  const after = app.view()
  near((600 - after.panOffset.x) / after.zoom, contentX)
  near((500 - after.panOffset.y) / after.zoom, contentY)
})

test('normal page wheel and a horizontal-only Ctrl-wheel do not change zoom', () => {
  const app = harness()
  const initial = app.fit().zoom
  assert.equal(app.wheel(100, { ctrlKey: false }).defaultPrevented, false)
  assert.equal(app.wheel(0, { deltaX: 100 }).defaultPrevented, false)
  near(app.view().zoom, initial)
  assert.equal(app.wheel(-100, { ctrlKey: false, metaKey: true }).defaultPrevented, true)
  assert.ok(app.view().zoom > initial)
})

test('fit and pinch minimum retain the same margin when the bitmap resolution changes', () => {
  const app = harness()
  const initial = app.fit().zoom
  near(app.view().getFitToScreenZoom(), initial)
  app.canvas.width *= 2
  app.canvas.height *= 2
  near(app.view().getFitToScreenZoom(), initial)
})

test('unmount removes wheel handlers from the shared surface and document', () => {
  const app = harness({ shared: true })
  app.fit()
  app.dispose()
  assert.equal(app.surface.listeners.get('wheel')?.size ?? 0, 0)
  assert.equal(app.document.listeners.get('wheel')?.size ?? 0, 0)
  assert.equal(app.wheel(-100, { target: 'overlay', renderAfter: false }).defaultPrevented, false)
})
