import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { bikes, categories, maintenanceItems, meterReadings, parts, user } from '../../../server/db/schema'
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
    // McpServer tools can be called directly or inspected via server.server
    const tools = await (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text: string }> }> }> })._registeredTools

    expect(tools.list_bikes).toBeDefined()
    const res = await tools.list_bikes.handler({})
    const list = JSON.parse(res.content[0]!.text)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Beta 300 RR')
  })

  it('get_maintenance_status returns items for owned bike', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.get_maintenance_status.handler({ bikeId: bikeA })
    const items = JSON.parse(res.content[0]!.text)
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('Transmission Oil')
  })

  it('get_maintenance_status rejects another user bikeId', async () => {
    const server = createMcpServer(userB) // Rider B has no bikes
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.get_maintenance_status.handler({ bikeId: bikeA })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain(`Bike ${bikeA} not found`)
  })

  it('log_ride logs a valid reading', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.log_ride.handler({ bikeId: bikeA, hours: 12.5, km: 350 })
    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain('Successfully logged reading')

    const readings = await db.select().from(meterReadings).where(eq(meterReadings.bikeId, bikeA))
    expect(readings).toHaveLength(1)
    expect(readings[0]!.hoursTenths).toBe(125)
    expect(readings[0]!.km).toBe(350)
  })

  it('log_service_completed records service and resets item', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.log_service_completed.handler({
      bikeId: bikeA,
      itemId: itemA,
      hours: 10.0,
      notes: 'Changed oil to Motorex',
    })
    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain("Service 'Transmission Oil' logged successfully")
  })

  it('adjust_part_stock modifies shelf stock', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.adjust_part_stock.handler({ partId: partA, deltaQuantity: 3, note: 'Bought from shop' })
    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain('Updated stock for')

    const [updated] = await db.select().from(parts).where(eq(parts.id, partA))
    expect(updated!.qtyHundredths).toBe(300)
  })

  it('add_expense creates an expense in the right category', async () => {
    const server = createMcpServer(userA)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools

    const res = await tools.add_expense.handler({
      amountEur: 24.5,
      description: 'Air filter and oil',
      categoryName: 'Maintenance',
      bikeId: bikeA,
    })

    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toContain('24.50 € under \'Maintenance\'')
  })
})
