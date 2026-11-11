import { describe, expect, it } from 'vitest'
import { getNavigationDirection } from '~/lib/navigation-motion'

describe('navigation-motion: getNavigationDirection', () => {
  it('slides left when navigating forward through primary tabs', () => {
    expect(getNavigationDirection('/', '/history')).toBe('slide-left')
    expect(getNavigationDirection('/history', '/invoice')).toBe('slide-left')
    expect(getNavigationDirection('/invoice', '/costs')).toBe('slide-left')
    expect(getNavigationDirection('/costs', '/shelf')).toBe('slide-left')
    expect(getNavigationDirection('/shelf', '/settings')).toBe('slide-left')
  })

  it('slides right when navigating backward through primary tabs', () => {
    expect(getNavigationDirection('/settings', '/shelf')).toBe('slide-right')
    expect(getNavigationDirection('/shelf', '/costs')).toBe('slide-right')
    expect(getNavigationDirection('/costs', '/invoice')).toBe('slide-right')
    expect(getNavigationDirection('/invoice', '/history')).toBe('slide-right')
    expect(getNavigationDirection('/history', '/')).toBe('slide-right')
  })

  it('pushes (slide-left) when drilling down into bike details', () => {
    expect(getNavigationDirection('/', '/bikes/1234-5678')).toBe('slide-left')
    expect(getNavigationDirection('/bikes/1234-5678', '/bikes/1234-5678/items/item-1')).toBe('slide-left')
    expect(getNavigationDirection('/bikes/1234-5678', '/bikes/1234-5678/settings')).toBe('slide-left')
  })

  it('pops (slide-right) when returning from bike details back to garage or parent', () => {
    expect(getNavigationDirection('/bikes/1234-5678', '/')).toBe('slide-right')
    expect(getNavigationDirection('/bikes/1234-5678/items/item-1', '/bikes/1234-5678')).toBe('slide-right')
    expect(getNavigationDirection('/bikes/1234-5678/settings', '/bikes/1234-5678')).toBe('slide-right')
  })

  it('slides up when opening a modal creation flow like /bikes/new', () => {
    expect(getNavigationDirection('/', '/bikes/new')).toBe('slide-up')
    expect(getNavigationDirection('/bikes/1234-5678', '/bikes/new')).toBe('slide-up')
  })

  it('slides down when dismissing a modal creation flow back to previous screen', () => {
    expect(getNavigationDirection('/bikes/new', '/')).toBe('slide-down')
  })
})
