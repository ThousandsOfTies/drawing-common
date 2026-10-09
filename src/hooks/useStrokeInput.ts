import { useEffect, useRef, type PointerEvent, type TouchEvent } from 'react'

export interface StrokeInputPoint {
  clientX: number
  clientY: number
  time: number
  pressure?: number
  pointerType: string
}

interface Options {
  enabled?: boolean
  /** PDF finger gestures are handled by the viewport, while Pencil touch events remain a fallback. */
  touchDrawing?: boolean
  /** Standalone canvases can draw with touch pointers; viewports use their Touch gesture handlers. */
  pointerTouchDrawing?: boolean
  onStart: (point: StrokeInputPoint) => boolean | void
  onMove: (points: StrokeInputPoint[]) => void
  onEnd: (reason: 'up' | 'cancel') => void
}

interface Session {
  source: 'pointer' | 'touch'
  id: number
  pointerType: string
  startedAt: number
  latestTime: number
  hasMoveSample: boolean
  sampleKeys: Set<string>
  companionTouchId?: number
  captureTarget?: Element
  onMove: Options['onMove']
  onEnd: Options['onEnd']
}

type InputTouch = Pick<Touch, 'identifier' | 'clientX' | 'clientY'> & { touchType?: string; force?: number }
const isStylus = (touch: InputTouch) => touch.touchType === 'stylus'
const eventTime = (time: number) => Number.isFinite(time) ? time : performance.now()
const sampleKey = (point: StrokeInputPoint) => `${point.clientX},${point.clientY},${point.pressure ?? ''}`

/** Input ownership is synchronous and independent of React's rendering schedule. */
export function useStrokeInput(options: Options) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const sessionRef = useRef<Session | null>(null)
  const completedAtRef = useRef(-Infinity)

  const releaseCapture = (session: Session) => {
    const target = session.captureTarget
    if (target?.hasPointerCapture(session.id)) target.releasePointerCapture(session.id)
  }

  const finish = (reason: 'up' | 'cancel', time?: number) => {
    const session = sessionRef.current
    if (!session) return false
    // Clear ownership before releasing capture or invoking callbacks that can render immediately.
    sessionRef.current = null
    completedAtRef.current = Math.max(completedAtRef.current, session.latestTime, time ?? session.latestTime)
    releaseCapture(session)
    session.onEnd(reason)
    return true
  }

  const begin = (source: Session['source'], id: number, point: StrokeInputPoint, target?: Element) => {
    if (optionsRef.current.enabled === false || point.time < completedAtRef.current) return false
    const previous = sessionRef.current
    if (previous) {
      if (previous.source !== source || previous.id !== id || point.time <= previous.latestTime) return false
      // A new down after a missing up starts a separate stroke, never a connecting chord.
      finish('cancel')
    }
    const session: Session = {
      source, id, pointerType: point.pointerType, startedAt: point.time,
      latestTime: point.time, hasMoveSample: false, sampleKeys: new Set([sampleKey(point)]),
      onMove: optionsRef.current.onMove, onEnd: optionsRef.current.onEnd,
    }
    sessionRef.current = session
    if (optionsRef.current.onStart(point) === false) {
      sessionRef.current = null
      return false
    }
    if (source === 'pointer' && target) {
      try {
        target.setPointerCapture(id)
        session.captureTarget = target
      } catch {
        // An already-cancelled native pointer cannot be captured; input can still end normally.
      }
    }
    return true
  }

  const matches = (source: Session['source'], id: number, time: number) => {
    const session = sessionRef.current
    return session && session.source === source && session.id === id && time >= session.startedAt
      ? session : null
  }

  const move = (session: Session, samples: StrokeInputPoint[], final = false) => {
    const points: StrokeInputPoint[] = []
    for (const point of [...samples].sort((a, b) => a.time - b.time)) {
      if (point.time < session.latestTime) continue
      if (point.time > session.latestTime) {
        session.latestTime = point.time
        session.sampleKeys.clear()
      }
      const key = sampleKey(point)
      if (session.sampleKeys.has(key)) continue
      session.sampleKeys.add(key)
      points.push(point)
    }
    // Even a clock-rounded tap needs a drawable final sample after its initial down.
    if (!points.length && final && !session.hasMoveSample && samples.length) points.push(samples[samples.length - 1])
    if (points.length) {
      session.hasMoveSample = true
      session.onMove(points)
    }
  }

  const pointerPoint = (event: Pick<globalThis.PointerEvent, 'clientX' | 'clientY' | 'timeStamp' | 'pressure' | 'pointerType'>): StrokeInputPoint => ({
    clientX: event.clientX, clientY: event.clientY, time: eventTime(event.timeStamp),
    pressure: event.pointerType === 'pen' ? event.pressure : undefined,
    pointerType: event.pointerType,
  })
  const touchPoint = (touch: InputTouch, time: number): StrokeInputPoint => ({
    clientX: touch.clientX, clientY: touch.clientY, time: eventTime(time),
    pressure: isStylus(touch) ? touch.force : undefined,
    pointerType: isStylus(touch) ? 'pen' : 'touch',
  })

  const onPointerDown = (event: PointerEvent) => {
    if ((event.pointerType === 'touch' && !optionsRef.current.pointerTouchDrawing) || event.button !== 0) return false
    const accepted = begin('pointer', event.pointerId, pointerPoint(event), event.currentTarget)
    if (accepted) event.preventDefault()
    return accepted
  }
  const onPointerMove = (event: PointerEvent) => {
    const session = matches('pointer', event.pointerId, eventTime(event.timeStamp))
    if (!session) return false
    const native = event.nativeEvent
    const coalesced = native.getCoalescedEvents?.() ?? []
    move(session, (coalesced.length ? coalesced : [native]).map(pointerPoint))
    return true
  }
  const onPointerUp = (event: PointerEvent) => {
    const session = matches('pointer', event.pointerId, eventTime(event.timeStamp))
    if (!session) return false
    // Keep a final movement even when no pointermove was delivered for a short stroke.
    move(session, [pointerPoint(event)], true)
    return finish('up', eventTime(event.timeStamp))
  }
  const onPointerCancel = (event: PointerEvent) => {
    return matches('pointer', event.pointerId, eventTime(event.timeStamp)) ? finish('cancel', eventTime(event.timeStamp)) : false
  }
  const onLostPointerCapture = (event: PointerEvent) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) return false
    return onPointerCancel(event)
  }

  const isPenActive = () => sessionRef.current?.pointerType === 'pen'
  const onTouchStart = (event: TouchEvent) => {
    const changed = Array.from(event.changedTouches)
    const stylus = changed.find(isStylus)
    // Pencil pointer events own the stroke; their companion Touch events cannot restart it.
    const pointerSession = sessionRef.current
    if (pointerSession?.source === 'pointer' && isPenActive()) {
      if (stylus && pointerSession.companionTouchId === undefined && eventTime(event.timeStamp) >= pointerSession.startedAt) {
        pointerSession.companionTouchId = stylus.identifier
      }
      return true
    }
    if (sessionRef.current?.source === 'pointer' && stylus) return true
    const touch = stylus ?? (optionsRef.current.touchDrawing !== false && event.touches.length === 1 ? changed[0] : undefined)
    if (!touch) return false
    const accepted = begin('touch', touch.identifier, touchPoint(touch, event.timeStamp))
    if (accepted && event.cancelable) event.preventDefault()
    return accepted
  }
  const onTouchMove = (event: TouchEvent) => {
    if (isPenActive() && sessionRef.current?.source === 'pointer') return true
    const session = sessionRef.current
    if (session?.source !== 'touch' || eventTime(event.timeStamp) < session.startedAt) return false
    const touch = Array.from(event.touches).find(touch => touch.identifier === session.id)
    if (!touch) return false
    move(session, [touchPoint(touch, event.timeStamp)])
    if (event.cancelable) event.preventDefault()
    return true
  }
  const endTouch = (event: TouchEvent, reason: 'up' | 'cancel') => {
    const changed = Array.from(event.changedTouches)
    // Inspect lifted touches, not just the remaining touches (which are empty after Pencil up).
    const session = sessionRef.current
    if (session?.source === 'pointer' && isPenActive()) {
      const companion = changed.find(touch => touch.identifier === session.companionTouchId)
      if (companion && eventTime(event.timeStamp) >= session.startedAt) {
        if (reason === 'up') move(session, [touchPoint(companion, event.timeStamp)], true)
        return finish(reason, eventTime(event.timeStamp))
      }
      return true
    }
    const touch = session?.source === 'touch' ? changed.find(touch => touch.identifier === session.id) : undefined
    if (!session || !touch || !matches('touch', touch.identifier, eventTime(event.timeStamp))) return changed.some(isStylus)
    if (reason === 'up') move(session, [touchPoint(touch, event.timeStamp)], true)
    return finish(reason, eventTime(event.timeStamp))
  }

  useEffect(() => {
    if (options.enabled === false) finish('cancel')
  }, [options.enabled])
  useEffect(() => () => {
    const session = sessionRef.current
    sessionRef.current = null
    if (session) releaseCapture(session)
  }, [])

  return {
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture,
    onTouchStart, onTouchMove,
    onTouchEnd: (event: TouchEvent) => endTouch(event, 'up'),
    onTouchCancel: (event: TouchEvent) => endTouch(event, 'cancel'),
    cancel: () => finish('cancel'),
    isActive: () => sessionRef.current !== null,
    isPenActive,
  }
}
