import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client'
import { bikes, itemNotes, maintenanceItems, parts, shoppingEntries } from '../db/schema'
import type { Bike, MaintenanceItem, Part } from '../db/schema'
import { createBike, createItem, itemRows, listBikes } from './bikes'
import { listCategories } from './categories'
import { costsOverview, todayStr } from '../domain/costs-query'
import { createExpense } from './expenses'
import { itemHistory } from './item-history'
import { createNote } from './item-notes'
import { adjustPart, createPart, listPartRows } from './parts'
import { logReading } from './readings'
import { createReminder, listReminders, markReminderDone } from './reminders'
import { createService } from './services'
import { createEntry, patchEntry, shoppingList } from './shopping'
import { templatesFor } from '../domain/templates'
import { matches } from '../../shared/utils/search'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuidString = (s: string): boolean => UUID_RE.test(s)

type ResolveBikeSuccess = { bike: Bike; error?: undefined }
type ResolveBikeNone = { bike: undefined; error?: undefined }
type ResolveBikeError = { bike?: undefined; error: string }
type ResolveBikeResult = ResolveBikeSuccess | ResolveBikeNone | ResolveBikeError

async function resolveBike(
  userId: string,
  query?: string | null,
  options: { required?: boolean } = { required: true },
): Promise<ResolveBikeResult> {
  const activeBikes = await db
    .select()
    .from(bikes)
    .where(and(eq(bikes.userId, userId), isNull(bikes.archivedAt)))

  const trimmed: string = typeof query === 'string' ? query.trim() : ''

  if (!trimmed) {
    if (!options.required) {
      return { bike: undefined }
    }
    if (activeBikes.length === 0) {
      return { error: 'No motorcycles found in garage.' }
    }
    if (activeBikes.length === 1) {
      return { bike: activeBikes[0]! }
    }
    return {
      error: `Multiple motorcycles found (${activeBikes.map((b) => b.name).join(', ')}). Please specify which bike.`,
    }
  }

  if (isUuidString(trimmed)) {
    const found = activeBikes.find((b) => b.id.toLowerCase() === trimmed.toLowerCase())
    if (found) return { bike: found }
    const [byId] = await db
      .select()
      .from(bikes)
      .where(and(eq(bikes.id, trimmed), eq(bikes.userId, userId)))
    if (byId) return { bike: byId }
    return { error: `Bike ${trimmed} not found.` }
  }

  const matched = activeBikes.filter((b) =>
    matches(trimmed, b.name, `${b.make} ${b.model}`, b.model, b.make),
  )

  if (matched.length === 1) {
    return { bike: matched[0]! }
  }
  if (matched.length > 1) {
    const target = trimmed.toLowerCase()
    const exact = matched.find((b) => b.name.toLowerCase() === target)
    if (exact) return { bike: exact }
    return {
      error: `Ambiguous motorcycle '${trimmed}'. Matches: ${matched.map((b) => b.name).join(', ')}.`,
    }
  }
  return { error: `Motorcycle '${trimmed}' not found.` }
}

type ResolveItemResult =
  | { item: MaintenanceItem; error?: undefined }
  | { item?: undefined; error: string }

async function resolveItem(
  userId: string,
  bikeId: string,
  query?: string | null,
): Promise<ResolveItemResult> {
  const trimmed: string = typeof query === 'string' ? query.trim() : ''
  if (!trimmed) {
    return { error: 'Please specify a maintenance item.' }
  }

  if (isUuidString(trimmed)) {
    const [item] = await db
      .select()
      .from(maintenanceItems)
      .where(and(eq(maintenanceItems.id, trimmed), eq(maintenanceItems.bikeId, bikeId)))
    if (item) return { item }
    return { error: `Maintenance item ${trimmed} not found on this bike.` }
  }

  const items = await db
    .select()
    .from(maintenanceItems)
    .where(and(eq(maintenanceItems.bikeId, bikeId), eq(maintenanceItems.userId, userId)))

  const matched = items.filter((i) => matches(trimmed, i.name))
  if (matched.length === 1) {
    return { item: matched[0]! }
  }
  if (matched.length > 1) {
    const target = trimmed.toLowerCase()
    const exact = matched.find((i) => i.name.toLowerCase() === target)
    if (exact) return { item: exact }
    return {
      error: `Ambiguous maintenance item '${trimmed}'. Matches: ${matched.map((i) => i.name).join(', ')}.`,
    }
  }
  return { error: `Maintenance item '${trimmed}' not found on this bike.` }
}

async function resolvePart(
  userId: string,
  query?: string | null,
): Promise<{ part?: Part; error?: string }> {
  const trimmed: string = typeof query === 'string' ? query.trim() : ''
  if (!trimmed) {
    return { error: 'Please specify a part name or partId.' }
  }
  if (isUuidString(trimmed)) {
    const [part] = await db
      .select()
      .from(parts)
      .where(and(eq(parts.id, trimmed), eq(parts.userId, userId)))
    if (part) return { part }
    return { error: `Part ${trimmed} not found.` }
  }

  const allParts = await db.select().from(parts).where(eq(parts.userId, userId))
  const matched = allParts.filter((p) => matches(trimmed, p.name, p.notes))
  if (matched.length === 1) {
    return { part: matched[0]! }
  }
  if (matched.length > 1) {
    const target = trimmed.toLowerCase()
    const exact = matched.find((p) => p.name.toLowerCase() === target)
    if (exact) return { part: exact }
    return {
      error: `Ambiguous part '${trimmed}'. Matches: ${matched.map((p) => p.name).join(', ')}.`,
    }
  }
  return { error: `Part '${trimmed}' not found.` }
}

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
      bike: z.string().optional().describe('Bike name, model, nickname, or UUID (optional if you have only one bike)'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter'),
    },
    async ({ bike: bikeQuery, bikeId }) => {
      const bikeRes = await resolveBike(userId, bikeQuery ?? bikeId, { required: true })
      if (bikeRes.error || !bikeRes.bike) {
        return { isError: true, content: [{ type: 'text', text: bikeRes.error ?? 'Bike not found.' }] }
      }
      const bike = bikeRes.bike
      const items = await itemRows(bike.id, userId, new Date())
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
      bike: z.string().optional().describe('Bike name, model, or UUID (optional if you have only one bike)'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter'),
      item: z.string().optional().describe('Maintenance item name or UUID (e.g. "Transmission Oil" or "Piston")'),
      itemId: z.string().optional().describe('Legacy maintenance item UUID parameter'),
      limit: z.number().int().min(1).max(20).optional().describe('Maximum entries to return (default 10)'),
    },
    async ({ bike: bikeQuery, bikeId, item: itemQuery, itemId, limit }) => {
      const bQuery = bikeQuery ?? bikeId
      const iQuery = itemQuery ?? itemId

      if (!iQuery) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Please specify an item or itemId.' }],
        }
      }

      if (isUuidString(iQuery)) {
        const [found] = await db
          .select()
          .from(maintenanceItems)
          .where(and(eq(maintenanceItems.id, iQuery), eq(maintenanceItems.userId, userId)))
        if (!found) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Maintenance item ${iQuery} not found.` }],
          }
        }
        const history = await itemHistory(found.id, userId)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ...history, services: history.services.slice(0, limit ?? 10) }, null, 2),
            },
          ],
        }
      }

      const bikeRes = await resolveBike(userId, bQuery, { required: true })
      if (bikeRes.error || !bikeRes.bike) {
        return { isError: true, content: [{ type: 'text', text: bikeRes.error ?? 'Bike not found.' }] }
      }

      const itemRes = await resolveItem(userId, bikeRes.bike.id, iQuery)
      if (itemRes.error || !itemRes.item) {
        return { isError: true, content: [{ type: 'text', text: itemRes.error ?? 'Item not found.' }] }
      }

      const history = await itemHistory(itemRes.item.id, userId)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ...history, services: history.services.slice(0, limit ?? 10) }, null, 2),
          },
        ],
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
        ? rows.filter((p) => matches(query, p.name, p.notes))
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
      bike: z.string().optional().describe('Optional bike name, model, or UUID to filter costs for a specific bike'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter to filter costs for a specific bike'),
    },
    async ({ period, date, bike: bikeQuery, bikeId }) => {
      let filterBikeId: string | null = null
      const bQuery = bikeQuery ?? bikeId
      if (bQuery) {
        const bikeRes = await resolveBike(userId, bQuery, { required: false })
        if (bikeRes.error) {
          return { isError: true, content: [{ type: 'text', text: bikeRes.error }] }
        }
        filterBikeId = bikeRes.bike?.id ?? null
      }

      const overview = await costsOverview(userId, {
        period,
        date: date ?? todayStr(),
        bikeId: filterBikeId,
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
      bike: z.string().optional().describe('Bike name, model, nickname, or UUID (optional if you have only one bike)'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter'),
      hours: z.number().min(0).optional().describe('Engine hours reading (e.g. 45.2)'),
      km: z.number().int().min(0).optional().describe('Odometer reading in kilometers (e.g. 1250)'),
      date: z.string().optional().describe('Date/time of reading (ISO 8601 or YYYY-MM-DD; defaults to now)'),
      condition: z.enum(['normal', 'mud', 'sand', 'dust', 'race']).optional().describe('Riding conditions'),
      confirmBigJump: z.boolean().optional().describe('Set true to confirm an unusually large jump in readings'),
    },
    async ({ bike: bikeQuery, bikeId, hours, km, date, condition, confirmBigJump }) => {
      const bikeRes = await resolveBike(userId, bikeQuery ?? bikeId, { required: true })
      if (bikeRes.error || !bikeRes.bike) {
        return { isError: true, content: [{ type: 'text', text: bikeRes.error ?? 'Bike not found.' }] }
      }
      const bike = bikeRes.bike

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
      bike: z.string().optional().describe('Bike name, model, nickname, or UUID (optional if you have only one bike)'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter'),
      item: z.string().optional().describe('Maintenance item name or UUID (e.g. "Transmission Oil")'),
      itemId: z.string().optional().describe('Legacy maintenance item UUID parameter'),
      date: z.string().optional().describe('Date the service was performed (YYYY-MM-DD; defaults to today)'),
      hours: z.number().min(0).optional().describe('Bike engine hours at the time of service'),
      km: z.number().int().min(0).optional().describe('Bike kilometers at the time of service'),
      by: z.enum(['diy', 'garage']).optional().describe('Who did the service (defaults to diy)'),
      notes: z.string().optional().describe('Optional notes about the service'),
    },
    async ({ bike: bikeQuery, bikeId, item: itemQuery, itemId, date, hours, km, by, notes }) => {
      const bikeRes = await resolveBike(userId, bikeQuery ?? bikeId, { required: true })
      if (bikeRes.error || !bikeRes.bike) {
        return { isError: true, content: [{ type: 'text', text: bikeRes.error ?? 'Bike not found.' }] }
      }
      const bike = bikeRes.bike

      const itemRes = await resolveItem(userId, bike.id, itemQuery ?? itemId)
      if (itemRes.error || !itemRes.item) {
        return { isError: true, content: [{ type: 'text', text: itemRes.error ?? 'Item not found.' }] }
      }
      const item = itemRes.item

      const payload = {
        clientId: randomUUID(),
        at: date ?? todayStr(),
        hoursTenths: hours !== undefined ? Math.round(hours * 10) : undefined,
        km,
        by: by ?? 'diy',
        notes,
        itemIds: [item.id],
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
      part: z.string().optional().describe('Part name or UUID'),
      partId: z.string().optional().describe('Legacy part UUID parameter'),
      deltaQuantity: z.number().describe('Quantity change (+/- number of units)'),
      note: z.string().optional().describe('Reason for adjustment'),
    },
    async ({ part: partQuery, partId, deltaQuantity, note }) => {
      const partRes = await resolvePart(userId, partQuery ?? partId)
      if (partRes.error || !partRes.part) {
        return { isError: true, content: [{ type: 'text', text: partRes.error ?? 'Part not found.' }] }
      }
      const part = partRes.part

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
      bike: z.string().optional().describe('Optional bike name, model, or UUID to link this expense to'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter'),
      date: z.string().optional().describe('Date of expense in YYYY-MM-DD (defaults to today)'),
    },
    async ({ amountEur, description, categoryName, bike: bikeQuery, bikeId, date }) => {
      let bike = null
      const bQuery = bikeQuery ?? bikeId
      if (bQuery) {
        const bikeRes = await resolveBike(userId, bQuery, { required: false })
        if (bikeRes.error) {
          return { isError: true, content: [{ type: 'text', text: bikeRes.error }] }
        }
        bike = bikeRes.bike ?? null
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

  // 11. get_reminders
  server.tool(
    'get_reminders',
    'Get open calendar reminders (due dates for Insurance, IUC/road tax, periodic inspection, licence, or custom reminders).',
    {
      bike: z.string().optional().describe('Optional bike name, model, or UUID to filter reminders for a specific bike'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter'),
    },
    async ({ bike: bikeQuery, bikeId }) => {
      const bQuery = bikeQuery ?? bikeId
      let filterBikeId: string | undefined
      if (bQuery) {
        const bikeRes = await resolveBike(userId, bQuery, { required: false })
        if (bikeRes.error) {
          return { isError: true, content: [{ type: 'text', text: bikeRes.error }] }
        }
        filterBikeId = bikeRes.bike?.id
      }

      const rows = await listReminders(userId, filterBikeId)
      return {
        content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
      }
    },
  )

  // 12. add_reminder (Write tool)
  server.tool(
    'add_reminder',
    'Create a new reminder (e.g. Insurance due date, annual road tax, technical inspection).',
    {
      title: z.string().describe('Title of the reminder (e.g. "Insurance", "IUC", "Inspection", or custom title)'),
      dueDate: z.string().describe('Due date in YYYY-MM-DD format (e.g. 2026-05-15)'),
      repeatYearly: z.boolean().optional().describe('Whether this reminder repeats annually (defaults to true)'),
      bike: z.string().optional().describe('Bike name, model, or UUID. If omitted and you have only 1 bike, defaults to that bike.'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter'),
    },
    async ({ title, dueDate, repeatYearly, bike: bikeQuery, bikeId }) => {
      const bQuery = bikeQuery ?? bikeId
      const bikeRes = await resolveBike(userId, bQuery, { required: false })
      if (bikeRes.error) {
        return { isError: true, content: [{ type: 'text', text: bikeRes.error }] }
      }

      try {
        const reminder = await createReminder(userId, bikeRes.bike ?? null, {
          clientId: randomUUID(),
          title,
          dueOn: dueDate,
          repeatYearly: repeatYearly ?? true,
        })
        const bikeLabel = bikeRes.bike ? ` for ${bikeRes.bike.name}` : ''
        return {
          content: [
            {
              type: 'text',
              text: `Reminder '${reminder.title}' created${bikeLabel}, due on ${reminder.dueOn}${reminder.repeatYearly ? ' (repeats yearly)' : ''}.`,
            },
          ],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed creating reminder: ${msg}` }],
        }
      }
    },
  )

  // 13. add_to_shopping_list (Write tool)
  server.tool(
    'add_to_shopping_list',
    'Add an item or spare part to the garage shopping list.',
    {
      text: z.string().describe('Description of the item to buy (e.g. "Front brake pads", "Air filter oil", "Chain lube")'),
      bike: z.string().optional().describe('Optional bike name, model, or UUID to link this item to'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter'),
    },
    async ({ text, bike: bikeQuery, bikeId }) => {
      const bQuery = bikeQuery ?? bikeId
      let bike = null
      if (bQuery) {
        const bikeRes = await resolveBike(userId, bQuery, { required: false })
        if (bikeRes.error) {
          return { isError: true, content: [{ type: 'text', text: bikeRes.error }] }
        }
        bike = bikeRes.bike ?? null
      }

      try {
        const entry = await db.transaction(async (tx) => {
          return await createEntry(tx, userId, {
            clientId: randomUUID(),
            text,
            bikeId: bike?.id ?? null,
          })
        })
        const bikeLabel = bike ? ` for ${bike.name}` : ''
        return {
          content: [
            {
              type: 'text',
              text: `Added '${entry.text}' to shopping list${bikeLabel}.`,
            },
          ],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed adding to shopping list: ${msg}` }],
        }
      }
    },
  )

  // 14. complete_shopping_item (Write tool)
  server.tool(
    'complete_shopping_item',
    'Mark a shopping list entry as bought / completed.',
    {
      query: z.string().describe('Text of the item or its UUID to complete (e.g. "brake pads")'),
    },
    async ({ query }) => {
      const list = await shoppingList(userId)
      const trimmed: string = query.trim()
      let found = list.manual.find((m) => m.id === trimmed && !m.doneAt)
      if (!found) {
        const matchesQuery = list.manual.filter((m) => !m.doneAt && matches(trimmed, m.text))
        if (matchesQuery.length === 1) {
          found = matchesQuery[0]!
        } else if (matchesQuery.length > 1) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Ambiguous shopping item '${trimmed}'. Matches: ${matchesQuery.map((m) => m.text).join(', ')}.`,
              },
            ],
          }
        }
      }

      if (!found) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Shopping item '${trimmed}' not found or already completed.` }],
        }
      }

      const [entry] = await db
        .select()
        .from(shoppingEntries)
        .where(and(eq(shoppingEntries.id, found.id), eq(shoppingEntries.userId, userId)))

      if (!entry) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Shopping entry ${found.id} not found.` }],
        }
      }

      try {
        await patchEntry(entry, { done: true })
        return {
          content: [{ type: 'text', text: `Marked '${entry.text}' as completed in shopping list.` }],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed completing shopping item: ${msg}` }],
        }
      }
    },
  )

  // 15. get_bike_notes
  server.tool(
    'get_bike_notes',
    'Look up technical notes, torque specifications, fluid capacities, clearances, or manual instructions for a motorcycle and its parts.',
    {
      bike: z.string().optional().describe('Bike name, model, or UUID (optional if you have only one bike)'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter'),
      query: z.string().optional().describe('Search query to filter notes (e.g. "torque", "spark plug", "transmission oil", "90 Nm")'),
    },
    async ({ bike: bikeQuery, bikeId, query }) => {
      const bQuery = bikeQuery ?? bikeId
      const bikeRes = await resolveBike(userId, bQuery, { required: false })
      if (bikeRes.error) {
        return { isError: true, content: [{ type: 'text', text: bikeRes.error }] }
      }

      const bike = bikeRes.bike

      const rows = await db
        .select({
          note: itemNotes,
          itemName: maintenanceItems.name,
          bikeName: bikes.name,
        })
        .from(itemNotes)
        .innerJoin(maintenanceItems, eq(itemNotes.itemId, maintenanceItems.id))
        .innerJoin(bikes, eq(maintenanceItems.bikeId, bikes.id))
        .where(
          and(
            eq(itemNotes.userId, userId),
            bike ? eq(maintenanceItems.bikeId, bike.id) : undefined,
          ),
        )

      let filtered = rows
      if (query && query.trim()) {
        const q: string = query.trim()
        filtered = rows.filter((r) => {
          const specsList = (r.note.specs as Array<{ label: string; value: string }>) || []
          return (
            matches(q, r.itemName, r.note.title, r.note.body) ||
            specsList.some((s) => matches(q, s.label, s.value))
          )
        })
      }

      const out = filtered.map((r) => ({
        id: r.note.id,
        bike: r.bikeName,
        item: r.itemName,
        title: r.note.title,
        body: r.note.body,
        specs: r.note.specs,
      }))

      return {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
      }
    },
  )

  // 16. add_shelf_part (Write tool)
  server.tool(
    'add_shelf_part',
    'Register a new spare part on the garage shelf inventory (name, initial stock count, unit, low stock alert threshold, bin/shelf notes, and vehicle compatibility).',
    {
      name: z.string().describe('Part name or description (e.g. "TwinAir Filter", "Motorex 10W40 Gear Oil", "Brembo Front Pads")'),
      quantity: z.number().min(0).optional().describe('Initial quantity on hand (defaults to 0)'),
      unit: z.string().optional().describe('Unit of measurement (e.g. "pcs", "bottle", "L", "set"; defaults to "pcs")'),
      minQuantity: z.number().min(0).optional().describe('Minimum stock alert threshold (warns when stock falls below this)'),
      notes: z.string().optional().describe('Optional bin location, OEM part number, or notes (e.g. "Shelf 2B, OEM 77202002000")'),
      bike: z.string().optional().describe('Optional bike name, model, or UUID this part belongs to'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter'),
      itemNames: z.array(z.string()).optional().describe('Optional list of maintenance item names or UUIDs on the bike that this part fits'),
    },
    async ({ name, quantity, unit, minQuantity, notes, bike: bikeQuery, bikeId, itemNames }) => {
      let bike: Bike | null = null
      const bQuery = bikeQuery ?? bikeId
      if (bQuery) {
        const bikeRes = await resolveBike(userId, bQuery, { required: false })
        if (bikeRes.error) {
          return { isError: true, content: [{ type: 'text', text: bikeRes.error }] }
        }
        bike = bikeRes.bike ?? null
      }

      const itemIds: string[] = []
      if (itemNames && itemNames.length > 0) {
        const userItems = await db
          .select({ id: maintenanceItems.id, name: maintenanceItems.name, bikeId: maintenanceItems.bikeId })
          .from(maintenanceItems)
          .where(and(eq(maintenanceItems.userId, userId), bike ? eq(maintenanceItems.bikeId, bike.id) : undefined))

        for (const itemName of itemNames) {
          const trimmed = itemName.trim()
          const found = userItems.find((i) => i.id === trimmed || matches(trimmed, i.name))
          if (found && !itemIds.includes(found.id)) {
            itemIds.push(found.id)
          }
        }
      }

      const qtyHundredths = quantity !== undefined ? Math.round(quantity * 100) : 0
      const minHundredths = minQuantity !== undefined ? Math.round(minQuantity * 100) : null

      try {
        const part = await db.transaction(async (tx) => {
          return await createPart(tx, userId, {
            clientId: randomUUID(),
            startClientId: qtyHundredths > 0 ? randomUUID() : undefined,
            name,
            unit: unit ?? 'pcs',
            qtyHundredths,
            minHundredths,
            notes: notes ?? null,
            bikeId: bike?.id ?? null,
            itemIds,
          })
        })

        const bikeLabel = bike ? ` for ${bike.name}` : ''
        return {
          content: [
            {
              type: 'text',
              text: `Part '${part.name}' registered on shelf with ${quantity ?? 0} ${part.unit}${bikeLabel}.${itemIds.length ? ` Linked to ${itemIds.length} maintenance item(s).` : ''}`,
            },
          ],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed adding part to shelf: ${msg}` }],
        }
      }
    },
  )

  // 17. add_vehicle (Write tool)
  server.tool(
    'add_vehicle',
    'Add a new motorcycle or car to the garage fleet, automatically setting up standard maintenance schedule templates.',
    {
      name: z.string().describe('Nickname or vehicle display name (e.g. "KTM 300 EXC \'23", "Beta 300 RR", "BMW E30")'),
      make: z.string().describe('Manufacturer make (e.g. "KTM", "Beta", "Honda", "Yamaha")'),
      model: z.string().describe('Model name (e.g. "300 EXC", "RR 300", "CRF450R")'),
      year: z.number().int().min(1950).max(2100).describe('Manufacture model year (e.g. 2023)'),
      vehicleType: z.enum(['motorcycle', 'car']).optional().describe('Vehicle type: motorcycle or car (defaults to motorcycle)'),
      stroke: z.enum(['2T', '4T']).optional().describe('Engine stroke: 2T or 4T (defaults to 2T for motorcycles, 4T for cars)'),
      meters: z.enum(['hours_km', 'hours', 'km']).optional().describe('Meter counting mode: hours_km, hours, or km (defaults to hours_km for 2T motorcycles, km for cars)'),
      hours: z.number().min(0).optional().describe('Current engine hours reading at setup (e.g. 45.2)'),
      km: z.number().int().min(0).optional().describe('Current odometer reading in kilometers (e.g. 3500)'),
      plate: z.string().optional().describe('License plate number (e.g. "AA-00-BB")'),
      premixRatio: z.number().int().min(10).max(100).optional().describe('Fuel premix ratio (e.g. 50 or 60 for 2T bikes)'),
      notes: z.string().optional().describe('General notes about the vehicle'),
      useTemplate: z.boolean().optional().describe('Whether to load default maintenance items for this vehicle type/stroke (defaults to true)'),
    },
    async ({ name, make, model, year, vehicleType, stroke, meters, hours, km, plate, premixRatio, notes, useTemplate }) => {
      const vType = vehicleType ?? 'motorcycle'
      const s = stroke ?? (vType === 'car' ? '4T' : '2T')
      const m = meters ?? (vType === 'car' ? 'km' : 'hours_km')
      const shouldSeed = useTemplate ?? true
      const templateItems = shouldSeed ? templatesFor(s, m, vType) : []

      const hoursTenths = (m === 'hours_km' || m === 'hours') ? (hours !== undefined ? Math.round(hours * 10) : 0) : null
      const kmVal = (m === 'hours_km' || m === 'km') ? (km ?? 0) : null

      try {
        const bike = await createBike(userId, {
          clientId: randomUUID(),
          name,
          make,
          model,
          year,
          vehicleType: vType,
          stroke: s,
          meters: m,
          plate: plate ?? null,
          premixRatio: vType !== 'car' && s === '2T' ? (premixRatio ?? 50) : null,
          notes: notes ?? null,
          hoursTenths,
          km: kmVal,
          items: templateItems,
        })

        return {
          content: [
            {
              type: 'text',
              text: `Vehicle '${bike.name}' (${bike.make} ${bike.model} ${bike.year}, ${bike.stroke}) added to garage with ${templateItems.length} maintenance items scheduled.`,
            },
          ],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed adding vehicle: ${msg}` }],
        }
      }
    },
  )

  // 18. add_maintenance_item (Write tool)
  server.tool(
    'add_maintenance_item',
    'Add a new maintenance schedule/item to a motorcycle or car (e.g. Fork oil replacement every 30h, Spark plug every 6000km, Coolant every 24 months).',
    {
      bike: z.string().optional().describe('Bike name, model, nickname, or UUID (optional if you have only one bike)'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter'),
      name: z.string().describe('Name of the maintenance task (e.g. "Fork oil replacement", "Brake pads check", "Valve clearance")'),
      everyHours: z.number().positive().optional().describe('Interval in engine hours (e.g. 30 for every 30h)'),
      everyKm: z.number().int().positive().optional().describe('Interval in kilometers (e.g. 5000)'),
      everyMonths: z.number().int().positive().optional().describe('Interval in calendar months (e.g. 12)'),
    },
    async ({ bike: bikeQuery, bikeId, name, everyHours, everyKm, everyMonths }) => {
      const bikeRes = await resolveBike(userId, bikeQuery ?? bikeId, { required: true })
      if (bikeRes.error || !bikeRes.bike) {
        return { isError: true, content: [{ type: 'text', text: bikeRes.error ?? 'Bike not found.' }] }
      }
      const bike = bikeRes.bike

      if (everyHours === undefined && everyKm === undefined && everyMonths === undefined) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Please specify at least one interval (everyHours, everyKm, or everyMonths).' }],
        }
      }

      try {
        const item = await createItem(bike, {
          clientId: randomUUID(),
          name,
          everyHoursTenths: everyHours !== undefined ? Math.round(everyHours * 10) : undefined,
          everyKm,
          everyMonths,
          conditionMultipliers: {},
        })

        const intervalsDesc = [
          everyHours !== undefined ? `${everyHours} h` : null,
          everyKm !== undefined ? `${everyKm} km` : null,
          everyMonths !== undefined ? `${everyMonths} months` : null,
        ].filter(Boolean).join(' or ')

        return {
          content: [
            {
              type: 'text',
              text: `Maintenance item '${item.name}' added to ${bike.name} (interval: every ${intervalsDesc}).`,
            },
          ],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed adding maintenance item: ${msg}` }],
        }
      }
    },
  )

  // 19. add_bike_note (Write tool)
  server.tool(
    'add_bike_note',
    'Save technical notes, torque specifications, clearances, fluid capacities, or setup instructions for a maintenance item and vehicle.',
    {
      bike: z.string().optional().describe('Bike name, model, or UUID (optional if you have only one bike)'),
      bikeId: z.string().optional().describe('Legacy bike UUID parameter'),
      item: z.string().optional().describe('Maintenance item name or UUID (e.g. "Transmission Oil", "Front Fork", "Piston")'),
      itemId: z.string().optional().describe('Legacy maintenance item UUID parameter'),
      title: z.string().describe('Title of the note (e.g. "Torque Specs", "Oil Capacity & Grade", "Suspension Clickers")'),
      body: z.string().optional().describe('Detailed explanation or procedure notes'),
      specs: z
        .array(
          z.object({
            label: z.string().describe('Specification label (e.g. "Drain bolt torque", "Fluid capacity", "Spark plug gap")'),
            value: z.string().describe('Specification value (e.g. "20 Nm", "800 ml Motorex 10W40", "0.6 mm")'),
          }),
        )
        .optional()
        .describe('Key-value technical specifications table'),
    },
    async ({ bike: bikeQuery, bikeId, item: itemQuery, itemId, title, body, specs }) => {
      const bQuery = bikeQuery ?? bikeId
      const bikeRes = await resolveBike(userId, bQuery, { required: false })
      if (bikeRes.error) {
        return { isError: true, content: [{ type: 'text', text: bikeRes.error }] }
      }

      const bike = bikeRes.bike
      const iQuery = itemQuery ?? itemId

      let item: MaintenanceItem | undefined
      if (iQuery) {
        if (bike) {
          const itemRes = await resolveItem(userId, bike.id, iQuery)
          if (itemRes.error) return { isError: true, content: [{ type: 'text', text: itemRes.error }] }
          item = itemRes.item
        } else {
          const allItems = await db.select().from(maintenanceItems).where(eq(maintenanceItems.userId, userId))
          const matched = allItems.filter((i) => i.id === iQuery || matches(iQuery, i.name))
          if (matched.length === 1) item = matched[0]!
          else if (matched.length > 1) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Ambiguous item '${iQuery}'. Please specify the bike.` }],
            }
          }
        }
      }

      if (!item) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Please specify the maintenance item to attach this note to (e.g. item: "Transmission Oil").' }],
        }
      }

      try {
        const note = await createNote(item, {
          clientId: randomUUID(),
          title,
          body: body ?? '',
          specs: specs ?? [],
        })

        return {
          content: [
            {
              type: 'text',
              text: `Note '${note.title}' added to '${item.name}'${specs?.length ? ` with ${specs.length} spec(s)` : ''}.`,
            },
          ],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed adding bike note: ${msg}` }],
        }
      }
    },
  )

  // 20. complete_reminder (Write tool)
  server.tool(
    'complete_reminder',
    'Mark a reminder as completed / renewed (e.g. Insurance renewed, annual road tax IUC paid, technical inspection passed).',
    {
      query: z.string().describe('Title of the reminder or its UUID (e.g. "Insurance", "IUC", "Inspection")'),
      bike: z.string().optional().describe('Optional bike name or model to filter reminders for a specific bike'),
    },
    async ({ query, bike: bikeQuery }) => {
      let filterBikeId: string | undefined
      if (bikeQuery) {
        const bikeRes = await resolveBike(userId, bikeQuery, { required: false })
        if (bikeRes.error) return { isError: true, content: [{ type: 'text', text: bikeRes.error }] }
        filterBikeId = bikeRes.bike?.id
      }

      const allReminders = await listReminders(userId, filterBikeId)
      const trimmed = query.trim()
      let matched = allReminders.filter((r) => r.id === trimmed)
      if (!matched.length) {
        matched = allReminders.filter((r) => matches(trimmed, r.title))
      }

      if (matched.length === 0) {
        return { isError: true, content: [{ type: 'text', text: `Reminder '${trimmed}' not found.` }] }
      }
      if (matched.length > 1) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Ambiguous reminder '${trimmed}'. Matches: ${matched.map((r) => `${r.title} (${r.bikeName ?? 'All bikes'})`).join(', ')}.` }],
        }
      }

      const target = matched[0]!
      try {
        const updated = await markReminderDone(userId, target, { dueOn: target.dueOn })
        const rolled = target.repeatYearly ? ` Rolled over to next year (due ${updated.dueOn}).` : ' Completed.'
        return {
          content: [
            {
              type: 'text',
              text: `Reminder '${target.title}' marked as done.${rolled}`,
            },
          ],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed completing reminder: ${msg}` }],
        }
      }
    },
  )

  // 21. delete_shelf_part (Write tool)
  server.tool(
    'delete_shelf_part',
    'Remove a spare part completely from the garage shelf inventory.',
    {
      part: z.string().optional().describe('Part name or UUID to remove'),
      partId: z.string().optional().describe('Legacy part UUID parameter'),
    },
    async ({ part: partQuery, partId }) => {
      const partRes = await resolvePart(userId, partQuery ?? partId)
      if (partRes.error || !partRes.part) {
        return { isError: true, content: [{ type: 'text', text: partRes.error ?? 'Part not found.' }] }
      }
      const part = partRes.part

      try {
        await db.delete(parts).where(and(eq(parts.id, part.id), eq(parts.userId, userId)))
        return {
          content: [{ type: 'text', text: `Part '${part.name}' removed from shelf inventory.` }],
        }
      } catch (err: unknown) {
        const msg = (err as { statusMessage?: string; message?: string })?.statusMessage || (err as Error)?.message || 'Unknown error'
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed deleting part: ${msg}` }],
        }
      }
    },
  )

  return server
}
