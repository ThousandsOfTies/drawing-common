const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const modules = new Map()
function load(name) {
  if (modules.has(name)) return modules.get(name)
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/rendering', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: id => load(id.replace('./', '')) })
  modules.set(name, exports)
  return exports
}
function context() {
  const fills = [], stack = []
  let circle
  const ctx = { fills, strokeStyle: '#123456', fillStyle: '#ffffff', globalAlpha: 0.4,
    globalCompositeOperation: 'destination-out',
    save() { stack.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, strokeStyle: this.strokeStyle }) },
    restore() { Object.assign(this, stack.pop()) }, beginPath() {},
    arc(x, y, radius) { circle = { x, y, radius } },
    fill() { fills.push({ ...circle, color: this.fillStyle, alpha: this.globalAlpha, operation: this.globalCompositeOperation }) },
  }
  return ctx
}

test('stationary tap samples paint one correctly scaled dot and retain eraser, color and opacity settings', () => {
  const { drawStationaryStroke } = load('drawStationaryStroke')
  const ctx = context()
  assert.equal(drawStationaryStroke(ctx, [{ x: 0.2, y: 0.3 }, { x: 0.2, y: 0.3 }], 8,
    { scaleX: 1000, scaleY: 500, widthScale: 2, offsetX: -20, offsetY: 10 }), true)
  assert.deepEqual(ctx.fills, [{ x: 180, y: 160, radius: 8, color: '#123456', alpha: 0.4, operation: 'destination-out' }])
  assert.equal(ctx.fillStyle, '#ffffff')
  assert.equal(ctx.globalAlpha, 0.4)
})

test('moving strokes continue through the original line renderer, and empty strokes paint nothing', () => {
  const { drawStationaryStroke } = load('drawStationaryStroke')
  const ctx = context()
  assert.equal(drawStationaryStroke(ctx, [], 8), false)
  assert.equal(drawStationaryStroke(ctx, [{ x: 10, y: 20 }, { x: 10.01, y: 20 }], 8), false)
  assert.equal(ctx.fills.length, 0)
})

test('CopiCopi crayon taps retain their pale body when pointer down and up share coordinates', () => {
  const { drawAdditionalStrokeStyle } = load('drawAdditionalStrokeStyle')
  const ctx = context()
  assert.equal(drawAdditionalStrokeStyle(ctx, { style: 'crayon', width: 8, color: '#345678',
    points: [{ x: 0.2, y: 0.3 }, { x: 0.2, y: 0.3 }] }, { scaleX: 100, scaleY: 100, widthScale: 1 }), true)
  assert.deepEqual(ctx.fills, [{ x: 20, y: 30, radius: 4, color: '#345678', alpha: 0.2, operation: 'destination-out' }])
  assert.equal(ctx.globalAlpha, 0.4)
})
