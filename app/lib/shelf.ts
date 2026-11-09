/** A part as `/api/parts` returns it (plus the flags the offline overlay adds). Quantities are integer hundredths. */
export type ShelfPart = {
  id: string; name: string; unit: string; qtyHundredths: number; minHundredths: number | null; notes: string | null
  bikeId: string | null; bikeName: string | null; itemIds: string[]; pending?: boolean; pendingSync?: boolean
}

/** `/api/shopping`: what the shelf says to buy, and the rider's own entries. */
export type AutoEntry = { key: string; partId: string; partName: string; unit: string; bikeId: string | null; bikeName: string | null; reason: 'due' | 'min'; detail: string }
export type ManualEntry = { id: string; text: string; bikeId: string | null; bikeName: string | null; partId: string | null; doneAt: string | null; pending?: boolean; pendingSync?: boolean }
export type ShoppingList = { auto: AutoEntry[]; manual: ManualEntry[] }
