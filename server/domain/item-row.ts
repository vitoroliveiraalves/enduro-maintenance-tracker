import type { ItemDef, LastDone, Status } from './maintenance-status'

/** One maintenance item with its derived state, as returned by the bike and items endpoints. */
export type ItemRow = {
  id: string
  name: string
  def: ItemDef
  last: (NonNullable<LastDone> & { serviceId: string; by: 'diy' | 'garage'; garageName?: string }) | null
  status: Status
}

type Json<T> = T extends Date ? string : T extends object ? { [K in keyof T]: Json<T[K]> } : T

/** The same row after JSON transport: dates arrive as ISO strings. */
export type ItemRowJson = Json<ItemRow>

export type BikeSummary = {
  id: string
  name: string
  make: string
  model: string
  year: number
  latestReading: { at: string; hoursTenths: number; km: number } | null
  counts: { overdue: number; soon: number }
}
