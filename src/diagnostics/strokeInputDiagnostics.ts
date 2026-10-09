import { isStrokeInputControl } from '../input/isStrokeInputControl'

type SummaryTouch = { identifier: number; clientX: number; clientY: number; force?: number; touchType?: string }
type SummaryEvent = {
  timeStamp: number
  target?: EventTarget | null
  currentTarget?: EventTarget | null
  pointerId?: number
  pointerType?: string
  button?: number
  buttons?: number
  pressure?: number
  clientX?: number
  clientY?: number
  cancelable?: boolean
  defaultPrevented?: boolean
  isTrusted?: boolean
  touches?: ArrayLike<SummaryTouch>
  changedTouches?: ArrayLike<SummaryTouch>
}

export interface StrokeInputDiagnosticEntry {
  phase: 'native' | 'handler' | 'stroke'
  type: string
  time: number
  [key: string]: unknown
}

const LIMIT = 1000
const records: StrokeInputDiagnosticEntry[] = []
const targets = new WeakMap<EventTarget, () => boolean>()
let enabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('strokeDebug') === '1'
let dispose: (() => void) | undefined
let counts = { penDown: 0, touchStart: 0, started: 0, ended: 0, rejected: 0 }
let lastHover = -Infinity

export const isStrokeInputDiagnosticsEnabled = () => enabled

export function registerStrokeInputTarget(target: HTMLElement, isEnabled: () => boolean) {
  targets.set(target, isEnabled)
  return () => targets.delete(target)
}

function drawingSurfaceState(target?: EventTarget | null): boolean | undefined {
  let registered = false
  for (let element = target instanceof Element ? target : null; element; element = element.parentElement) {
    const isEnabled = targets.get(element)
    if (!isEnabled) continue
    registered = true
    if (isEnabled()) return true
  }
  return registered ? false : undefined
}

function append(entry: StrokeInputDiagnosticEntry) {
  if (!enabled) return
  records.push(entry)
  if (records.length > LIMIT) records.splice(0, records.length - LIMIT)
}

function describeTouches(touches?: ArrayLike<SummaryTouch>) {
  return touches ? Array.from(touches, touch => ({
    id: touch.identifier,
    type: touch.touchType,
    x: touch.clientX, y: touch.clientY, force: touch.force,
  })) : undefined
}

export function recordStrokeInputEvent(
  phase: 'native' | 'handler', type: string, event: SummaryEvent, details: Record<string, unknown> = {},
) {
  if (!enabled) return
  if (isStrokeInputControl(event.target)) return
  const drawingEnabled = phase === 'native' ? drawingSurfaceState(event.target) : undefined
  if (phase === 'native' && drawingEnabled === undefined) return
  if (phase === 'native' && type === 'pointerdown' && event.pointerType === 'pen') counts.penDown++
  if (phase === 'native' && type === 'touchstart') counts.touchStart++
  if (phase === 'handler' && type === 'pointerdown' && details.accepted === false) counts.rejected++
  // Retain evidence of hover-only input without letting it replace the recent contacts.
  if (phase === 'native' && type === 'pointermove' && event.pointerType === 'pen' && event.buttons === 0) {
    if (event.timeStamp - lastHover < 100) return
    lastHover = event.timeStamp
  }
  const element = event.target instanceof Element ? event.target : null
  append({ phase, type, time: event.timeStamp, pointerId: event.pointerId,
    pointerType: event.pointerType, button: event.button, buttons: event.buttons,
    pressure: event.pressure, x: event.clientX, y: event.clientY,
    cancelable: event.cancelable, defaultPrevented: event.defaultPrevented, trusted: event.isTrusted,
    drawingEnabled,
    target: element ? `${element.tagName}.${String(element.className).slice(0, 80)}` : undefined,
    touches: describeTouches(event.touches), changedTouches: describeTouches(event.changedTouches), ...details,
  })
}

export function recordStrokeLifecycle(type: 'start' | 'end', details: Record<string, unknown>) {
  if (!enabled) return
  if (type === 'start') counts.started++
  else counts.ended++
  append({ phase: 'stroke', type, time: performance.now(), ...details })
}

/** Opt-in, bounded, in-memory records. No document content or network requests. */
export function startStrokeInputDiagnostics() {
  if (!enabled || dispose) return
  const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture',
    'lostpointercapture', 'touchstart', 'touchmove', 'touchend', 'touchcancel']
  const record = (event: Event) => recordStrokeInputEvent('native', event.type, event)
  for (const type of types) window.addEventListener(type, record, { capture: true, passive: true })
  dispose = () => {
    for (const type of types) window.removeEventListener(type, record, true)
    dispose = undefined
  }
}

export function stopStrokeInputDiagnostics() {
  enabled = false
  dispose?.()
}

export function clearStrokeInputDiagnostics() {
  records.length = 0
  counts = { penDown: 0, touchStart: 0, started: 0, ended: 0, rejected: 0 }
  lastHover = -Infinity
}

export const getStrokeInputDiagnosticsSummary = () => ({ ...counts, records: records.length })

export function getStrokeInputDiagnosticsReport(metadata: Record<string, unknown> = {}) {
  return JSON.stringify({ ...metadata, userAgent: navigator.userAgent, counts: getStrokeInputDiagnosticsSummary(),
    records: records.slice() }, null, 2)
}
