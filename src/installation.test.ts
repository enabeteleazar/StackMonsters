import { describe, expect, it } from 'vitest'
import { plateformeDe } from './installation'

describe('plateformeDe', () => {
  it('reconnaît iPhone et iPad, y compris l’iPad qui se présente comme un Mac', () => {
    expect(plateformeDe('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe('ios')
    expect(plateformeDe('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', 5)).toBe('ios')
    expect(plateformeDe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios')
  })

  it('reconnaît Android', () => {
    expect(plateformeDe('Mozilla/5.0 (Linux; Android 14; Pixel 7)', 5)).toBe('android')
  })

  it('n’invite pas un ordinateur', () => {
    expect(plateformeDe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('autre')
    expect(plateformeDe('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe('autre')
  })
})
