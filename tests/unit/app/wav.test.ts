import { describe, expect, it } from 'vitest'
import { downsample, encodeWav } from '../../../app/lib/wav'

describe('encodeWav', () => {
  it('writes a 16 kHz mono 16-bit PCM header with data length = 2 × samples', () => {
    const buf = encodeWav(new Float32Array(1000), 16_000)
    const v = new DataView(buf)
    const s = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4))
    expect(s(0)).toBe('RIFF')
    expect(s(8)).toBe('WAVE')
    expect(s(12)).toBe('fmt ')
    expect(v.getUint16(20, true)).toBe(1) // PCM
    expect(v.getUint16(22, true)).toBe(1) // mono
    expect(v.getUint32(24, true)).toBe(16_000)
    expect(v.getUint32(28, true)).toBe(32_000) // byte rate
    expect(v.getUint16(34, true)).toBe(16)
    expect(s(36)).toBe('data')
    expect(v.getUint32(40, true)).toBe(2000)
    expect(v.getUint32(4, true)).toBe(36 + 2000)
    expect(buf.byteLength).toBe(44 + 2000)
  })
  it('clips at ±1', () => {
    const v = new DataView(encodeWav(new Float32Array([2, -2, 0.5, 0]), 16_000))
    expect(v.getInt16(44, true)).toBe(32767)
    expect(v.getInt16(46, true)).toBe(-32768)
    expect(v.getInt16(48, true)).toBe(Math.round(0.5 * 32767))
    expect(v.getInt16(50, true)).toBe(0)
  })
})

describe('downsample', () => {
  it('48000 → 16000 divides the length by 3 and averages', () => {
    const out = downsample(new Float32Array([0.3, 0.3, 0.3, 0.6, 0.6, 0.6]), 48_000, 16_000)
    expect(out).toHaveLength(2)
    expect(out[0]).toBeCloseTo(0.3)
    expect(out[1]).toBeCloseTo(0.6)
    expect(downsample(new Float32Array(48_000), 48_000, 16_000)).toHaveLength(16_000)
  })
  it('44100 → 16000 and same-rate pass-through', () => {
    expect(downsample(new Float32Array(44_100), 44_100, 16_000)).toHaveLength(16_000)
    const same = new Float32Array([1, 2])
    expect(downsample(same, 16_000, 16_000)).toBe(same)
  })
})
