const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(pixelRatio = 2) {
  const exports = {}
  const source = fs.readFileSync(path.join(__dirname, '../src/rendering/canvasResolution.ts'), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, window: { devicePixelRatio: pixelRatio } })
  return exports
}

function canvas() {
  const transforms = []
  return { width: 300, height: 150, style: {}, transforms,
    getContext: () => ({ setTransform: (...args) => transforms.push(args) }) }
}

test('Retina backing pixels increase without changing the paper or drawing coordinate size', () => {
  const { resizeCanvasForDisplay, getCanvasLogicalSize } = load()
  const target = canvas()
  resizeCanvasForDisplay(target, 800, 1132)
  assert.equal(target.width, 1600)
  assert.equal(target.height, 2264)
  assert.deepEqual(target.style, { width: '800px', height: '1132px' })
  assert.deepEqual(target.transforms, [[2, 0, 0, 2, 0, 0]])
  assert.equal(getCanvasLogicalSize(target).width, 800)
  assert.equal(getCanvasLogicalSize(target).height, 1132)
})

test('large sheets stay within the pixel budget and preserve their logical layout', () => {
  const { resizeCanvasForDisplay, getCanvasLogicalSize } = load(3)
  const target = canvas()
  resizeCanvasForDisplay(target, 2000, 2500)
  assert.ok(target.width * target.height <= 7_000_000)
  assert.ok(target.width > 2000)
  assert.equal(getCanvasLogicalSize(target).width, 2000)
  const [scaleX, , , scaleY] = target.transforms[0]
  assert.equal(scaleX, target.width / 2000)
  assert.equal(scaleY, target.height / 2500)
  resizeCanvasForDisplay(target, 4000, 4000)
  assert.ok(target.width * target.height <= 7_000_000)
  assert.ok(target.width < 4000)
  assert.equal(getCanvasLogicalSize(target).width, 4000)
})

test('standard screens and unconfigured canvases retain their original coordinate size', () => {
  const { resizeCanvasForDisplay, getCanvasLogicalSize } = load(1)
  const target = canvas()
  assert.equal(getCanvasLogicalSize(target).width, 300)
  resizeCanvasForDisplay(target, 800, 1132)
  assert.equal(target.width, 800)
  assert.equal(target.height, 1132)
  assert.deepEqual(target.transforms, [[1, 0, 0, 1, 0, 0]])
})

test('reinitializing a sheet replaces the display geometry and caps excessive device density', () => {
  const { resizeCanvasForDisplay, getCanvasLogicalSize } = load(4)
  const target = canvas()
  resizeCanvasForDisplay(target, 800, 1132)
  resizeCanvasForDisplay(target, 1200, 849)
  assert.equal(target.width, 2400)
  assert.equal(target.height, 1698)
  assert.equal(getCanvasLogicalSize(target).width, 1200)
  assert.equal(target.style.height, '849px')
})
