import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { bikes, maintenanceItems, parts } from '../db/schema'
import { itemRows, listBikes } from './bikes'
import { listCategories } from './categories'
import { costsOverview, todayStr } from '../domain/costs-query'
import { createExpense } from './expenses'
import { itemHistory } from './item-history'
import { adjustPart, listPartRows } from './parts'
import { logReading } from './readings'
import { createService } from './services'
import { shoppingList } from './shopping'
import { matches } from '../../shared/utils/search'

export function createMcpServer(userId: string): McpServer {
  const server = new McpServer({
    name: 'dirt-garage',
    version: '1.0.0',
  })

  // 1. list_bikes
  server.tool(
    'list_bikes',
    "List the rider's active motorcycles: id, name, make, model, year, engine stroke (2T/4T), meter mode, and latest hours/km.",
    {},
    async () => {
      const rows = await listBikes(userId)
      return {
        content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
      }
    },
  )

  // 2. get_maintenance_status
  server.tool(
    'get_maintenance_status',
    'Get all maintenance items for a motorcycle with due state, hours/km left, percentage worn, and intervals.',
    {
      bikeId: z.string().describe('The UUID of the bike'),
    },
    async ({ bikeId }) => {
      const [bike] = await db
        .select()
        .from(bikes)
        .where(and(eq(bikes.id, bikeId), eq(bikes.userId, userId)))

      if (!bike) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Bike ${bikeId} not found.` }],
        }
      }

      const items = await itemRows(bikeId, userId, new Date())
      return {
        content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
      }
    },
  )

  // 3. get_service_history
  server.tool(
    'get_service_history',
    'Get past services recorded for a maintenance item (e.g. past oil changes or piston swaps).',
    {
      itemId: z.string().describe('The UUID of the maintenance item'),
      limit: z.number().int().min(1).max(20).optional().describe('Maximum entries to return (default 10)'),
    },
    async ({ itemId, limit }) => {
      const history = await itemHistory(itemId, userId)
      const out = {
        ...history,
        services: history.services.slice(0, limit ?? 10),
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
      }
    },
  )

  // 4. get_shelf_inventory
  server.tool(
    'get_shelf_inventory',
    'List or search spare parts in the garage shelf stock (part numbers, brand, stock count, bin location).',
    {
      query: z.string().optional().describe('Optional search query to filter parts by name, number, or notes'),
    },
    async ({ query }) => {
      const rows = await listPartRows(userId)
      const filtered = query
        ? rows.filter((p) => matches(p.name, query) || (p.notes ? matches(p.notes, query) : false))
        : rows
      return {
        content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }],
      }
    },
  )

  // 5. get_shopping_list
  server.tool(
    'get_shopping_list',
    'Get parts to buy: automatic entries for maintenance items due soon without stock, plus manual shopping list entries.',
    {},
    async () => {
      const list = await shoppingList(userId)
      return {
        content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
      }
    },
  )

  // 6. get_expenses_summary
  server.tool(
    'get_expenses_summary',
    'Get a summary of expenses (in cents EUR) for a given time period, broken down by category (parts, gear, workshop, fuel).',
    {
      period: z.enum(['month', 'year', 'all']).describe('Time window: month, year, or all-time'),
      date: z.string().optional().describe('YYYY-MM-DD date inside the period (defaults to today)'),
      bikeId: z.string().optional().describe('Optional bike UUID to filter costs for a specific bike'),
    },
    async ({ period, date, bikeId }) => {
      const overview = await costsOverview(userId, {
        period,
        date: date ?? todayStr(),
        bikeId: bikeId ?? null,
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(overview, null, 2) }],
      }
    },
  )

  // 7. log_ride (Write tool)
  server.tool(
    'log_ride',
    'Log a new meter reading (hours and/or odometer km) for a motorcycle after a ride.',
    {
      bikeId: z.string().describe('The UUID of the bike'),
      hours: z.number().min(0).optional().describe('Engine hours reading (e.g. 45.2)'),
      km: z.number().int().min(0).optional().describe('Odometer reading in kilometers (e.g. 1250)'),
      date: z.string().optional().describe('Date/time of reading (ISO 8601 or YYYY-MM-DD; defaults to now)'),
      condition: z.enum(['normal', 'mud', 'sand', 'dust', 'race']).optional().describe('Riding conditions'),
      confirmBigJump: z.boolean().optional().describe('Set true to confirm an unusually large jump in readings'),
    },
    async ({ bikeId, hours, km, date, condition, confirmBigJump }) => {
      const [bike] = await db
        .select()
        .from(bikes)
        .where(and(eq(bikes.id, bikeId), eq(bikes.userId, userId)))

      if (!bike) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Bike ${bikeId} not found.` }],
        }
      }

      const hoursTenths = hours !== undefined ? Math.round(hours * 10) : undefined
      const payload = {
        clientId: randomUUID(),
        at: date ?? new Date().toISOString(),
        hoursTenths,
        km,
        condition: condition ?? 'normal',
        confirmBigJump: confirmBigJump ?? false,
      }

      try {
        const result = await logReading(bike, payload)
        if (result.status !== 200) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Reading rejected: ${JSON.stringify(result.body)}` }],
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: `Successfully logged reading for ${bike.name}: ${hours !== undefined ? `${hours.toFixed(1)} h` : ''} ${km !== undefined ? `${km} km` : ''}.`,
            },
          ],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed logging reading: ${msg}` }],
        }
      }
    },
  )

  // 8. log_service_completed (Write tool)
  server.tool(
    'log_service_completed',
    'Record that a maintenance service was completed on a bike (resets service interval for the item).',
    {
      bikeId: z.string().describe('The UUID of the bike'),
      itemId: z.string().describe('The UUID of the maintenance item serviced'),
      date: z.string().optional().describe('Date the service was performed (YYYY-MM-DD; defaults to today)'),
      hours: z.number().min(0).optional().describe('Bike engine hours at the time of service'),
      km: z.number().int().min(0).optional().describe('Bike kilometers at the time of service'),
      by: z.enum(['diy', 'garage']).optional().describe('Who did the service (defaults to diy)'),
      notes: z.string().optional().describe('Optional notes about the service'),
    },
    async ({ bikeId, itemId, date, hours, km, by, notes }) => {
      const [bike] = await db
        .select()
        .from(bikes)
        .where(and(eq(bikes.id, bikeId), eq(bikes.userId, userId)))

      if (!bike) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Bike ${bikeId} not found.` }],
        }
      }

      const [item] = await db
        .select()
        .from(maintenanceItems)
        .where(and(eq(maintenanceItems.id, itemId), eq(maintenanceItems.bikeId, bikeId)))

      if (!item) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Maintenance item ${itemId} not found on bike ${bike.name}.` }],
        }
      }

      const payload = {
        clientId: randomUUID(),
        at: date ?? todayStr(),
        hoursTenths: hours !== undefined ? Math.round(hours * 10) : undefined,
        km,
        by: by ?? 'diy',
        notes,
        itemIds: [itemId],
      }

      try {
        await createService(bike, payload)
        return {
          content: [
            {
              type: 'text',
              text: `Service '${item.name}' logged successfully for ${bike.name}. Interval reset.`,
            },
          ],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed logging service: ${msg}` }],
        }
      }
    },
  )

  // 9. adjust_part_stock (Write tool)
  server.tool(
    'adjust_part_stock',
    'Adjust the stock count of a spare part in the garage (e.g. +2 when purchased, -1 when used).',
    {
      partId: z.string().describe('The UUID of the part'),
      deltaQuantity: z.number().describe('Quantity change (+/- number of units)'),
      note: z.string().optional().describe('Reason for adjustment'),
    },
    async ({ partId, deltaQuantity, note }) => {
      const [part] = await db
        .select()
        .from(parts)
        .where(and(eq(parts.id, partId), eq(parts.userId, userId)))

      if (!part) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Part ${partId} not found.` }],
        }
      }

      const deltaHundredths = Math.round(deltaQuantity * 100)
      if (deltaHundredths === 0) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'deltaQuantity cannot be 0.' }],
        }
      }

      try {
        await db.transaction(async (tx) => {
          await adjustPart(tx, userId, part, {
            clientId: randomUUID(),
            qtyHundredths: deltaHundredths,
            note,
          })
        })

        return {
          content: [
            {
              type: 'text',
              text: `Updated stock for '${part.name}' by ${deltaQuantity > 0 ? `+${deltaQuantity}` : deltaQuantity} ${part.unit}.`,
            },
          ],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed adjusting stock: ${msg}` }],
        }
      }
    },
  )

  // 10. add_expense (Write tool)
  server.tool(
    'add_expense',
    'Record a cost or expense in Euros (e.g. parts, workshop fee, gear, fuel).',
    {
      amountEur: z.number().positive().describe('Expense amount in Euros (e.g. 35.50)'),
      description: z.string().describe('Description of the expense'),
      categoryName: z.string().optional().describe('Category name or kind (e.g. parts, service, gear, fuel, other)'),
      bikeId: z.string().optional().describe('Optional bike UUID to link this expense to'),
      date: z.string().optional().describe('Date of expense in YYYY-MM-DD (defaults to today)'),
    },
    async ({ amountEur, description, categoryName, bikeId, date }) => {
      let bike = null
      if (bikeId) {
        const [b] = await db
          .select()
          .from(bikes)
          .where(and(eq(bikes.id, bikeId), eq(bikes.userId, userId)))
        if (!b) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Bike ${bikeId} not found.` }],
          }
        }
        bike = b
      }

      const categoriesList = await listCategories(userId)
      let matchedCategory = categoriesList[0]
      if (categoryName) {
        const target = categoryName.toLowerCase()
        const found = categoriesList.find((c) => c.name.toLowerCase() === target || c.kind.toLowerCase() === target)
        if (found) matchedCategory = found
      }

      if (!matchedCategory) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'No expense category found.' }],
        }
      }

      const amountCents = Math.round(amountEur * 100)
      const payload = {
        clientId: randomUUID(),
        at: date ?? todayStr(),
        amountCents,
        categoryId: matchedCategory.id,
        description,
        bikeId: bike?.id ?? null,
      }

      try {
        const created = await createExpense(userId, bike, payload)
        return {
          content: [
            {
              type: 'text',
              text: `Expense logged: ${amountEur.toFixed(2)} € under '${matchedCategory.name}' (${created.description || 'no description'}).`,
            },
          ],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed adding expense: ${msg}` }],
        }
      }
    },
  )

  return server
}
