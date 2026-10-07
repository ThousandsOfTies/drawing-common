type PixelChanges = { runs: Uint32Array; pixels: Uint8ClampedArray }
type Entry<T> = { state: T; previous: PixelChanges | null }

// Keep one complete pre-operation image. Older images are reversible pixel runs,
// so untouched paper and metadata-only edits do not multiply canvas-sized buffers.
function difference(previous: ImageData, next: ImageData): PixelChanges {
  const before = new Uint32Array(previous.data.buffer, previous.data.byteOffset, previous.data.length / 4)
  const after = new Uint32Array(next.data.buffer, next.data.byteOffset, next.data.length / 4)
  const spans: number[] = []
  let changed = 0
  for (let i = 0; i < before.length;) {
    if (before[i] === after[i]) { i++; continue }
    const start = i++
    while (i < before.length && before[i] !== after[i]) i++
    spans.push(start, i - start)
    changed += i - start
    // Dense changes are cheaper as one full reverse image than many small runs.
    if (changed * 4 + spans.length * 4 >= previous.data.byteLength) {
      return { runs: new Uint32Array([0, before.length]), pixels: previous.data }
    }
  }
  const pixels = new Uint8ClampedArray(changed * 4)
  let offset = 0
  for (let i = 0; i < spans.length; i += 2) {
    const start = spans[i] * 4
    const length = spans[i + 1] * 4
    pixels.set(previous.data.subarray(start, start + length), offset)
    offset += length
  }
  return { runs: new Uint32Array(spans), pixels }
}

export class CanvasUndoHistory<T = undefined> {
  private entries: Entry<T>[] = []
  private latest: ImageData | null = null

  get length() { return this.entries.length }

  // Pixel-buffer size, excluding the application's metadata and JS object overhead.
  get byteLength() {
    return (this.latest?.data.byteLength ?? 0) + this.entries.reduce((sum, entry) =>
      sum + (entry.previous ? entry.previous.runs.byteLength + entry.previous.pixels.byteLength : 0), 0)
  }

  clear() {
    this.entries = []
    this.latest = null
  }

  push(canvas: HTMLCanvasElement, state: T): boolean {
    const context = canvas.getContext('2d')
    if (!context || !canvas.width || !canvas.height) return false
    if (this.latest && (this.latest.width !== canvas.width || this.latest.height !== canvas.height)) this.clear()
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    this.entries.push({ state, previous: this.latest ? difference(this.latest, image) : null })
    this.latest = image
    return true
  }

  undo(canvas: HTMLCanvasElement): { state: T } | null {
    const context = canvas.getContext('2d')
    if (!context || !this.latest) return null
    if (canvas.width !== this.latest.width || canvas.height !== this.latest.height) {
      this.clear()
      return null
    }
    const entry = this.entries.pop()
    if (!entry) return null
    context.putImageData(this.latest, 0, 0)
    if (entry.previous) {
      const { runs, pixels } = entry.previous
      let offset = 0
      for (let i = 0; i < runs.length; i += 2) {
        const length = runs[i + 1] * 4
        this.latest.data.set(pixels.subarray(offset, offset + length), runs[i] * 4)
        offset += length
      }
    }
    if (!this.entries.length) this.latest = null
    return { state: entry.state }
  }
}
