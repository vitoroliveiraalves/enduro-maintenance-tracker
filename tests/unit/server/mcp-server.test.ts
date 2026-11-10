import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { bikes, categories, itemNotes, maintenanceItems, meterReadings, parts, reminders, shoppingEntries, user } from '../../../server/db/schema'
import { createMcpServer } from '../../../server/utils/mcp-server'
import { truncateUsers } from '../../support/truncate'

let userA: string
let userB: string
let bikeA: string
let itemA: string
let partA: string

beforeEach(async () => {
  await truncateUsers()
  const users = await db
    .insert(user)
    .values([
      { name: 'Rider A', email: 'a@example.com' },
      { name: 'Rider B', email: 'b@example.com' },
    ])
    .returning()
  userA = users[0]!.id
  userB = users[1]!.id

  const [b] = await db
    .insert(bikes)
    .values({
      userId: userA,
      name: 'Beta 300 RR',
      make: 'Beta',
      model: 'RR 300',
      year: 2024,
      stroke: '2T',
      meters: 'hours_km',
    })
    .returning()
  bikeA = b!.id

  const [m] = await db
    .insert(maintenanceItems)
    .values({
      userId: userA,
      bikeId: bikeA,
      name: 'Transmission Oil',
      everyHoursTenths: 300, // 30.0 hours
    })
    .returning()
  itemA = m!.id

  const [p] = await db
    .insert(parts)
    .values({
      userId: userA,
      name: 'Motorex Gear Oil 10W40',
      unit: 'bottle',
    })
    .returning()
  partA = p!.id

  await db
    .insert(categories)
    .values({
      userId: userA,
      name: 'Maintenance',
      kind: 'service',
    })
})

describe('MCP Server Tools', () => {
  it('list_bikes returns the user bikes', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text: string }> }> }> })._registeredTools

    expect(tools.list_bikes).toBeDefined()
    const res = await tools.list_bikes.handler({})
    const list = JSON.parse(res.content[0]!.text)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Beta 300 RR')
  })

  it('get_maintenance_status returns items for owned bike by id and fuzzy name', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text: string }> }> }> })._registeredTools

    // By ID
    const resId = await tools.get_maintenance_status.handler({ bikeId: bikeA })
    const itemsId = JSON.parse(resId.content[0]!.text)
    expect(itemsId).toHaveLength(1)
    expect(itemsId[0].name).toBe('Transmission Oil')

    // By fuzzy name
    const resFuzzy = await tools.get_maintenance_status.handler({ bike: 'Beta' })
    const itemsFuzzy = JSON.parse(resFuzzy.content[0]!.text)
    expect(itemsFuzzy).toHaveLength(1)
    expect(itemsFuzzy[0].name).toBe('Transmission Oil')

    // Without specifying bike (defaults to sole bike)
    const resDefault = await tools.get_maintenance_status.handler({})
    const itemsDefault = JSON.parse(resDefault.content[0]!.text)
    expect(itemsDefault).toHaveLength(1)
    expect(itemsDefault[0].name).toBe('Transmission Oil')
  })

  it('get_maintenance_status rejects another user bikeId', async () => {
    const server = createMcpServer(userB) // Rider B has no bikes
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.get_maintenance_status.handler({ bikeId: bikeA })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain(`Bike ${bikeA} not found`)
  })

  it('get_service_history works with fuzzy item and bike', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.get_service_history.handler({ bike: 'Beta', item: 'oil' })
    expect(res.isError).toBeFalsy()
    const history = JSON.parse(res.content[0]!.text)
    expect(history.item.name).toBe('Transmission Oil')
  })

  it('log_ride logs a valid reading with fuzzy bike name', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.log_ride.handler({ bike: 'Beta 300', hours: 12.5, km: 350 })
    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain('Successfully logged reading')

    const readings = await db.select().from(meterReadings).where(eq(meterReadings.bikeId, bikeA))
    expect(readings).toHaveLength(1)
    expect(readings[0]!.hoursTenths).toBe(125)
    expect(readings[0]!.km).toBe(350)
  })

  it('log_service_completed records service and resets item with fuzzy names', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.log_service_completed.handler({
      bike: 'Beta',
      item: 'Transmission Oil',
      hours: 10.0,
      notes: 'Changed oil to Motorex',
    })
    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain("Service 'Transmission Oil' logged successfully")
  })

  it('adjust_part_stock modifies shelf stock using part name', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.adjust_part_stock.handler({ part: 'Motorex', deltaQuantity: 3, note: 'Bought from shop' })
    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain('Updated stock for')

    const [updated] = await db.select().from(parts).where(eq(parts.id, partA))
    expect(updated!.qtyHundredths).toBe(300)
  })

  it('add_expense creates an expense with fuzzy bike name', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.add_expense.handler({
      amountEur: 24.5,
      description: 'Air filter and oil',
      categoryName: 'Maintenance',
      bike: 'Beta',
    })

    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain('24.50 € under \'Maintenance\'')
  })

  it('add_reminder and get_reminders manage calendar reminders', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const addRes = await tools.add_reminder.handler({
      title: 'Insurance',
      dueDate: '2026-06-01',
      bike: 'Beta',
      repeatYearly: true,
    })
    expect(addRes.isError).toBeFalsy()
    expect(addRes.content[0]!.text).toContain("Reminder 'Insurance' created for Beta 300 RR")

    const getRes = await tools.get_reminders.handler({ bike: 'Beta' })
    expect(getRes.isError).toBeFalsy()
    const list = JSON.parse(getRes.content[0]!.text)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('Insurance')
    expect(list[0].dueOn).toBe('2026-06-01')

    const dbReminders = await db.select().from(reminders).where(eq(reminders.userId, userA))
    expect(dbReminders).toHaveLength(1)
  })

  it('add_to_shopping_list and complete_shopping_item manage shopping items', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const addRes = await tools.add_to_shopping_list.handler({
      text: 'Brake pads front',
      bike: 'Beta',
    })
    expect(addRes.isError).toBeFalsy()
    expect(addRes.content[0]!.text).toContain("Added 'Brake pads front' to shopping list for Beta 300 RR")

    const completeRes = await tools.complete_shopping_item.handler({
      query: 'brake pads',
    })
    expect(completeRes.isError).toBeFalsy()
    expect(completeRes.content[0]!.text).toContain("Marked 'Brake pads front' as completed")

    const [entry] = await db.select().from(shoppingEntries).where(eq(shoppingEntries.userId, userA))
    expect(entry!.doneAt).not.toBeNull()
  })

  it('get_bike_notes returns technical notes and specs', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    await db.insert(itemNotes).values({
      userId: userA,
      itemId: itemA,
      title: 'Oil Specs',
      body: 'Use synthetic gear oil',
      specs: [
        { label: 'Drain bolt torque', value: '20 Nm' },
        { label: 'Capacity', value: '800 ml' },
      ],
    })

    const res = await tools.get_bike_notes.handler({ bike: 'Beta', query: 'torque' })
    expect(res.isError).toBeFalsy()
    const notes = JSON.parse(res.content[0]!.text)
    expect(notes).toHaveLength(1)
    expect(notes[0].item).toBe('Transmission Oil')
    expect(notes[0].specs[0].label).toBe('Drain bolt torque')
  })
})
