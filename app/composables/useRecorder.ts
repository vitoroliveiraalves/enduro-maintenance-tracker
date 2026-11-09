import { downsample, encodeWav } from '~/lib/wav'

export type RecorderState = 'idle' | 'asking' | 'recording' | 'denied' | 'unsupported'

export const MAX_SECONDS = 60
const RATE = 16_000

// Posts each 128-frame block of channel 0 to the page.
const WORKLET = `class Tap extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true }
}
registerProcessor('enduro-tap', Tap)`

/**
 * Microphone → 16 kHz mono 16-bit WAV, encoded here (decision 5): Web Audio PCM via an
 * AudioWorklet, ScriptProcessor where worklets are missing. Stops by itself at 60 s.
 */
export function useRecorder() {
  const state = ref<RecorderState>('idle')
  const level = ref(0)
  const seconds = ref(0)
  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null
  let node: AudioNode | null = null
  let chunks: Float32Array[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let startedAt = 0
  let onAutoStop: ((wav: ArrayBuffer | null) => void) | null = null

  function take(c: Float32Array) {
    if (state.value !== 'recording') return
    chunks.push(c)
    let sum = 0
    for (let i = 0; i < c.length; i++) sum += c[i]! * c[i]!
    level.value = Math.min(1, Math.sqrt(sum / c.length) * 4)
  }

  function teardown() {
    if (timer) clearInterval(timer)
    timer = null
    node?.disconnect()
    node = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    void ctx?.close().catch(() => {})
    ctx = null
    level.value = 0
  }

  async function start(): Promise<void> {
    if (state.value === 'recording' || state.value === 'asking') return
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!navigator.mediaDevices?.getUserMedia || !Ctx) return void (state.value = 'unsupported')
    state.value = 'asking'
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      const name = (e as { name?: string }).name
      state.value = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported'
      return
    }
    ctx = new Ctx()
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    const src = ctx.createMediaStreamSource(stream)
    chunks = []
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      const w = new AudioWorkletNode(ctx, 'enduro-tap')
      w.port.onmessage = (e: MessageEvent<Float32Array>) => take(e.data)
      node = w
    } catch {
      const sp = ctx.createScriptProcessor(4096, 1, 1)
      sp.onaudioprocess = (e) => take(new Float32Array(e.inputBuffer.getChannelData(0)))
      node = sp
    }
    src.connect(node)
    node.connect(ctx.destination) // keeps the graph pulling; the node writes no output
    startedAt = Date.now()
    seconds.value = 0
    state.value = 'recording'
    timer = setInterval(() => {
      seconds.value = Math.min(MAX_SECONDS, Math.floor((Date.now() - startedAt) / 1000))
      if (Date.now() - startedAt >= MAX_SECONDS * 1000) void stop().then((w) => onAutoStop?.(w))
    }, 250)
  }

  /** The WAV recorded so far, or null when nothing was recording. */
  async function stop(): Promise<ArrayBuffer | null> {
    if (state.value !== 'recording' || !ctx) return null
    const rate = ctx.sampleRate
    state.value = 'idle'
    teardown()
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const all = new Float32Array(total)
    let off = 0
    for (const c of chunks) {
      all.set(c, off)
      off += c.length
    }
    chunks = []
    return encodeWav(downsample(all, rate, RATE).subarray(0, MAX_SECONDS * RATE), RATE)
  }

  function cancel() {
    chunks = []
    if (state.value === 'recording' || state.value === 'asking') state.value = 'idle'
    teardown()
  }

  onBeforeUnmount(cancel)
  return { state, level, seconds, start, stop, cancel, onAutoStop: (fn: (wav: ArrayBuffer | null) => void) => (onAutoStop = fn) }
}
