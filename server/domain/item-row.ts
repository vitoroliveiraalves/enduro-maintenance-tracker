import type { BikeMeters } from '../../shared/utils/meters'
import type { ItemDef, LastDone, Status } from './maintenance-status'

/** One maintenance item with its derived state, as returned by the bike and items endpoints. */
export type ItemRow = {
  id: string
  name: string
  def: ItemDef
  last: (NonNullable<LastDone> & { serviceId: string; by: 'diy' | 'garage'; garageName?: string }) | null
  status: Status
  /** Spare parts on the shelf for this item: null = none linked, 'none' = any linked part is out, else 'in'. */
  stock: 'in' | 'none' | null
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
  vehicleType?: 'motorcycle' | 'car'
  plate?: string | null
  meters: BikeMeters
  latestReading: { at: string; hoursTenths: number | null; km: number | null } | null
  counts: { overdue: number; soon: number }
}
