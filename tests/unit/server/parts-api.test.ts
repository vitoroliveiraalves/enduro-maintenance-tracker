import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../server/db/client'
import { categories, expenses, partMovements, parts, user } from '../../../server/db/schema'
import deletePart from '../../../server/api/parts/[id].delete'
import getPart from '../../../server/api/parts/[id].get'
import { adjustPart, applyMovement } from '../../../server/utils/parts'
import { truncateUsers } from '../../support/truncate'

vi.mock('../../../server/utils/require-user', () => ({
  requireUser: async (event: { context: { uid?: string } }) => ({ id: event.context.uid, email: 'x@example.com' }),
}))
const as = (uid: string, id: string) => ({ context: { uid, params: { id } } }) as never

let uid: string
let partId: string
let expenseId: string

beforeEach(async () => {
  await truncateUsers()
  const [u] = await db.insert(user).values({ name: 'A', email: 'a@example.com' }).returning()
  uid = u!.id
  const [cat] = await db.insert(categories).values({ userId: uid, name: 'Parts', kind: 'other' }).returning()
  const [exp] = await db.insert(expenses).values({ userId: uid, at: '2026-11-01', amountCents: 2400, categoryId: cat!.id }).returning()
  expenseId = exp!.id
  const [p] = await db.insert(parts).values({ userId: uid, clientId: crypto.randomUUID(), name: 'Spark plug' }).returning()
  partId = p!.id
  await db.transaction((tx) =>
    applyMovement(tx, { userId: uid, clientId: crypto.randomUUID(), part: p!, partName: p!.name, unit: p!.unit, kind: 'bought', qtyHundredths: 400, at: '2026-11-01', expenseId }),
  )
})

describe('parts routes', () => {
  it('history shows the unit price of a bought movement (expense amount / qty)', async () => {
    const detail = (await getPart(as(uid, partId))) as { qtyHundredths: number; history: Array<{ kind: string; unitCents: number | null }> }
    expect(detail.qtyHundredths).toBe(400)
    expect(detail.history).toMatchObject([{ kind: 'bought', unitCents: 600 }])
  })

  it('delete keeps the movement snapshot and the bought expense', async () => {
    expect(await deletePart(as(uid, partId))).toEqual({ ok: true })
    expect(await db.select().from(parts)).toHaveLength(0)
    const [m] = await db.select().from(partMovements)
    expect(m).toMatchObject({ partId: null, partName: 'Spark plug', expenseId })
    expect(await db.select().from(expenses).where(eq(expenses.id, expenseId))).toHaveLength(1)
  })

  it('adjustPart with kind bought and amountCents records a bought movement and creates an expense', async () => {
    const [p] = await db.select().from(parts).where(eq(parts.id, partId))
    await db.transaction((tx) =>
      adjustPart(tx, uid, p!, { clientId: crypto.randomUUID(), qtyHundredths: 200, kind: 'bought', amountCents: 1800, note: 'Online order' }),
    )
    const detail = (await getPart(as(uid, partId))) as { qtyHundredths: number; history: Array<{ kind: string; unitCents: number | null; note: string | null }> }
    expect(detail.qtyHundredths).toBe(600)
    expect(detail.history[0]).toMatchObject({ kind: 'bought', unitCents: 900, note: 'Online order' })
    const allExpenses = await db.select().from(expenses).where(eq(expenses.userId, uid))
    expect(allExpenses).toHaveLength(2)
  })
})
