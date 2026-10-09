const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function recorder(search = '?strokeDebug=1') {
  const listeners = new Map(), removed = [], exports = {}
  class Element {
    constructor(tagName = 'CANVAS', parentElement = null) {
      this.tagName = tagName; this.parentElement = parentElement; this.className = 'drawing-canvas'
    }
    closest() { return this.tagName === 'BUTTON' ? this : this.parentElement?.closest() ?? null }
  }
  const window = {
    location: { search },
    addEventListener(type, callback, options) { listeners.set(type, { callback, options }) },
    removeEventListener(type, callback, capture) {
      assert.equal(callback, listeners.get(type).callback)
      assert.equal(capture, true)
      removed.push(type); listeners.delete(type)
    },
  }
  const filename = path.join(__dirname, '../src/diagnostics/strokeInputDiagnostics.ts')
  const inputControl = {}
  const controlFile = path.join(__dirname, '../src/input/isStrokeInputControl.ts')
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(controlFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: inputControl }, { filename: controlFile })
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, { exports, window, Element, URLSearchParams,
    navigator: { userAgent: 'test-browser' }, performance: { now: () => 100 },
    require(id) { assert.equal(id, '../input/isStrokeInputControl'); return inputControl },
  }, { filename })
  return { api: exports, Element, listeners, removed,
    emit(type, target, values = {}) {
      listeners.get(type)?.callback({ type, target, timeStamp: 10, pointerType: 'pen',
        pointerId: 7, buttons: 1, pressure: 0.5, ...values })
    },
    report: () => JSON.parse(exports.getStrokeInputDiagnosticsReport()),
  }
}

test('normal URLs leave the recorder inactive with no global event listeners', () => {
  for (const search of ['', '?strokeDebug=0']) {
    const app = recorder(search)
    app.api.startStrokeInputDiagnostics()
    app.api.recordStrokeLifecycle('start', { id: 1 })
    assert.equal(app.api.isStrokeInputDiagnosticsEnabled(), false)
    assert.equal(app.listeners.size, 0)
    assert.equal(app.report().records.length, 0)
  }
})

test('received Pencil starts and accepted strokes are counted separately, excluding controls but reporting a disabled surface', () => {
  const app = recorder(), surface = new app.Element('DIV'), child = new app.Element('CANVAS', surface)
  const button = new app.Element('BUTTON', surface)
  let enabled = true
  const unregister = app.api.registerStrokeInputTarget(surface, () => enabled)
  app.api.startStrokeInputDiagnostics()
  app.api.startStrokeInputDiagnostics()
  assert.equal(app.listeners.size, 10)
  assert.ok([...app.listeners.values()].every(({ options }) => options.capture && options.passive))
  app.emit('pointerdown', child)
  app.emit('touchstart', child, { changedTouches: [{ identifier: 11, touchType: 'stylus', clientX: 20, clientY: 30, force: 0 }] })
  app.api.recordStrokeLifecycle('start', { source: 'pointer', id: 7 })
  app.emit('pointerdown', child, { pointerId: 8, timeStamp: 20 })
  app.api.recordStrokeInputEvent('handler', 'pointerdown', { timeStamp: 20, pointerId: 8 }, { accepted: false })
  app.emit('pointerdown', button)
  app.emit('touchstart', button)
  enabled = false
  app.emit('pointerdown', child)
  enabled = true
  unregister()
  app.emit('pointerdown', child)
  assert.deepEqual(app.report().counts, { penDown: 3, touchStart: 1, started: 1, ended: 0, rejected: 1, records: 6 })
  assert.equal(app.report().records[1].changedTouches[0].force, 0)
  assert.equal(app.report().records[4].accepted, false)
  assert.equal(app.report().records[5].drawingEnabled, false)
})

test('the report retains at most 1000 recent entries, and reset clears totals and records', () => {
  const app = recorder()
  for (let id = 0; id < 1200; id++) app.api.recordStrokeLifecycle('start', { id })
  const report = app.report()
  assert.equal(report.records.length, 1000)
  assert.equal(report.records[0].id, 200)
  assert.equal(report.records.at(-1).id, 1199)
  assert.equal(report.counts.started, 1200)
  app.api.clearStrokeInputDiagnostics()
  assert.deepEqual(app.report().counts, { penDown: 0, touchStart: 0, started: 0, ended: 0, rejected: 0, records: 0 })
})

test('stopping removes every observer and rejects further records', () => {
  const app = recorder()
  app.api.startStrokeInputDiagnostics()
  app.api.stopStrokeInputDiagnostics()
  app.api.stopStrokeInputDiagnostics()
  app.api.startStrokeInputDiagnostics()
  app.api.recordStrokeLifecycle('start', { id: 1 })
  assert.equal(app.removed.length, 10)
  assert.equal(app.listeners.size, 0)
  assert.equal(app.report().records.length, 0)
})
