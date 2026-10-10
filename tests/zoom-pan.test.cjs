const { test } = require('node:test')
const assert = require('node:assert/strict')
const { harness } = require('./helpers/zoom-pan-harness.cjs')

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
    app.view().setZoom(0.001)
    near(app.view().zoom, minimum)
    app.wheel(100)
    near(app.view().zoom, minimum)
  }
  app.canvas.width *= 4; app.canvas.height *= 4
  near(app.view().getMinimumZoom(), minimum)
  app.view().setZoom(0.001)
  near(app.view().zoom, minimum)
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

test('every public viewport command enforces the floor without caller-side clamping', () => {
  for (const command of [
    view => view.setZoom(0.001),
    view => view.setZoom(previous => previous / 100),
    view => view.zoomAt(0.001, { x: 260, y: 190 }),
    view => view.restoreViewport({ zoom: 0.001, panOffset: { x: 0, y: 0 } }, { width: 600, height: 800 }),
  ]) {
    const app = harness({ width: 520, height: 380 })
    const floor = app.fit().zoom
    const retained = app.view()
    for (let repeat = 0; repeat < 20; repeat++) command(retained)
    near(app.view().zoom, floor)
    retained.setZoom(100)
    near(app.view().zoom, 5)
    retained.setZoom(previous => previous / 1.2)
    assert.ok(app.view().zoom < 5)
  }
})

test('direct and overlay pinch commands use the bounded zoom when projecting the anchor', () => {
  const app = harness({ width: 520, height: 380, left: 510 })
  const floor = app.fit().zoom
  const center = { x: 770, y: 240 }
  for (let repeat = 0; repeat < 20; repeat++) {
    const before = app.view().getViewport()
    const gesture = { startZoom: before.zoom, startPan: before.panOffset, startDist: 100, startCenter: center }
    const content = { x: (260 - before.panOffset.x) / before.zoom, y: (190 - before.panOffset.y) / before.zoom }
    app.view().applyPinch(gesture, { distance: 0.001, center })
    const after = app.view().getViewport()
    near(after.zoom, floor)
    near((260 - after.panOffset.x) / after.zoom, content.x)
    near((190 - after.panOffset.y) / after.zoom, content.y)
  }
  const before = app.view().getViewport()
  app.view().applyPinch({ startZoom: before.zoom, startPan: before.panOffset, startDist: 100, startCenter: center },
    { distance: 200, center })
  near(app.view().zoom, floor * 2)
})

test('a page turn validates the destination paper instead of the old page bitmap', () => {
  const app = harness({ width: 520, height: 380 })
  app.fit()
  app.view().restoreViewport({ zoom: 0.15, panOffset: { x: 170, y: 10 } }, { width: 1200, height: 2400 })
  near(app.view().zoom, 0.15)
  near(app.view().panOffset.x, 170)
  near(app.view().panOffset.y, 10)
  // The old portrait page would have rejected the destination's smaller fit.
  assert.equal(app.canvas.clientWidth, 600)
  assert.equal(app.canvas.clientHeight, 800)
})

test('fit, reset and rapid functional updates publish one coherent viewport immediately', () => {
  const app = harness({ width: 520, height: 380 })
  const command = app.view()
  command.fitToScreen(600, 800)
  near(command.getViewport().zoom, 0.45)
  for (let repeat = 0; repeat < 4; repeat++) command.setZoom(previous => previous + 0.1)
  near(command.getViewport().zoom, 0.85)
  command.resetZoom()
  near(command.getViewport().zoom, 1)
  const copy = command.getViewport()
  copy.panOffset.x = -999
  near(command.getViewport().panOffset.x, 0)
})

test('invalid zoom and pinch data leave the coherent viewport intact', () => {
  const app = harness()
  app.fit()
  const before = app.view().getViewport()
  for (const zoom of [NaN, Infinity, -Infinity]) app.view().setZoom(zoom)
  for (const [startDist, distance] of [[0, 100], [100, NaN], [100, Infinity]]) {
    app.view().applyPinch({ startZoom: before.zoom, startPan: before.panOffset, startDist,
      startCenter: { x: 200, y: 200 } }, { distance, center: { x: 200, y: 200 } })
  }
  assert.deepEqual(app.view().getViewport(), before)
})
