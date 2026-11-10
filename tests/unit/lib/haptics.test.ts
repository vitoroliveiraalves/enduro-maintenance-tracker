import { describe, expect, it, vi } from 'vitest'
import { tick } from '../../../app/lib/haptics'

describe('haptics', () => {
  it('vibrates briefly where supported and never throws', () => {
    const vibrate = vi.fn().mockReturnValue(true)
    tick({ vibrate })
    expect(vibrate).toHaveBeenCalledWith(10)
    expect(() => tick({})).not.toThrow()
    expect(() => tick(undefined)).not.toThrow()
    expect(() => tick({ vibrate: () => { throw new Error('blocked') } })).not.toThrow()
  })
})
