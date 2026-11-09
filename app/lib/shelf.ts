/** A part as `/api/parts` returns it (plus the flags the offline overlay adds). Quantities are integer hundredths. */
export type ShelfPart = {
  id: string; name: string; unit: string; qtyHundredths: number; minHundredths: number | null; notes: string | null
  bikeId: string | null; bikeName: string | null; itemIds: string[]; pending?: boolean; pendingSync?: boolean
}
