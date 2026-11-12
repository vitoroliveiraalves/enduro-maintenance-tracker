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

  it('add_shelf_part creates a brand-new spare part on the shelf', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.add_shelf_part.handler({
      name: 'TwinAir Air Filter',
      quantity: 2,
      unit: 'pcs',
      minQuantity: 1,
      notes: 'Bin 3B, OEM #77202002000',
      bike: 'Beta',
      itemNames: ['Transmission Oil'],
    })

    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain("Part 'TwinAir Air Filter' registered on shelf with 2 pcs for Beta 300 RR")

    const allParts = await db.select().from(parts).where(eq(parts.userId, userA))
    const filterPart = allParts.find((p) => p.name === 'TwinAir Air Filter')
    expect(filterPart).toBeDefined()
    expect(filterPart!.qtyHundredths).toBe(200)
    expect(filterPart!.minHundredths).toBe(100)
    expect(filterPart!.notes).toBe('Bin 3B, OEM #77202002000')
    expect(filterPart!.bikeId).toBe(bikeA)
  })

  it('add_vehicle creates a new motorcycle with template maintenance items', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.add_vehicle.handler({
      name: "KTM 300 EXC '23",
      make: 'KTM',
      model: '300 EXC',
      year: 2023,
      vehicleType: 'motorcycle',
      stroke: '2T',
      meters: 'hours_km',
      hours: 142.5,
      km: 3812,
      plate: '01-AB-23',
      premixRatio: 50,
      useTemplate: true,
    })

    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain("Vehicle 'KTM 300 EXC '23' (KTM 300 EXC 2023, 2T) added to garage")

    const userBikes = await db.select().from(bikes).where(eq(bikes.userId, userA))
    const ktm = userBikes.find((b) => b.name === "KTM 300 EXC '23")
    expect(ktm).toBeDefined()
    expect(ktm!.plate).toBe('01-AB-23')

    const items = await db.select().from(maintenanceItems).where(eq(maintenanceItems.bikeId, ktm!.id))
    expect(items.length).toBeGreaterThan(0)
  })

  it('add_maintenance_item adds a custom maintenance interval to a bike', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.add_maintenance_item.handler({
      bike: 'Beta',
      name: 'Fork oil replacement',
      everyHours: 40,
      everyMonths: 12,
    })

    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain("Maintenance item 'Fork oil replacement' added to Beta 300 RR")

    const [item] = await db.select().from(maintenanceItems).where(eq(maintenanceItems.name, 'Fork oil replacement'))
    expect(item).toBeDefined()
    expect(item!.everyHoursTenths).toBe(400)
    expect(item!.everyMonths).toBe(12)
  })

  it('add_bike_note saves technical specs to an item', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.add_bike_note.handler({
      bike: 'Beta',
      item: 'Transmission Oil',
      title: 'Transmission Specs',
      body: 'Drain bolt is located at the bottom right.',
      specs: [
        { label: 'Drain bolt torque', value: '20 Nm' },
        { label: 'Check bolt torque', value: '10 Nm' },
      ],
    })

    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain("Note 'Transmission Specs' added to 'Transmission Oil' with 2 spec(s)")

    const allNotes = await db.select().from(itemNotes).where(eq(itemNotes.userId, userA))
    const note = allNotes.find((n) => n.title === 'Transmission Specs')
    expect(note).toBeDefined()
    expect(note!.specs).toHaveLength(2)
  })

  it('complete_reminder rolls over a yearly reminder', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    await db.insert(reminders).values({
      userId: userA,
      bikeId: bikeA,
      title: 'Road Tax (IUC)',
      dueOn: '2026-04-15',
      repeatYearly: true,
    })

    const res = await tools.complete_reminder.handler({
      query: 'IUC',
      bike: 'Beta',
    })

    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain("Reminder 'Road Tax (IUC)' marked as done. Rolled over to next year (due 2027-04-15)")
  })

  it('delete_shelf_part removes a part from shelf inventory', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.delete_shelf_part.handler({
      part: 'Motorex',
    })

    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain("Part 'Motorex Gear Oil 10W40' removed from shelf inventory")

    const [deleted] = await db.select().from(parts).where(eq(parts.id, partA))
    expect(deleted).toBeUndefined()
  })
})
