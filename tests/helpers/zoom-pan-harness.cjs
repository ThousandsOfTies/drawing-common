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
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/hooks/useZoomPan.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const geometry = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/geometry/viewport.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: geometry })
  const exports = {}
  vm.runInNewContext(code, { exports, require: id => {
    if (id === 'react') return react
    assert.equal(id, '../geometry/viewport'); return geometry
  }, document, window })
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
    fit() { result.fitToScreen(); return render() },
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

module.exports = { harness }
