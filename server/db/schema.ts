import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`)
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
const clientId = () => uuid('client_id')

// ---- better-auth tables ----------------------------------------------------

export const user = pgTable('user', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  /** Beta AI features (invoice line reading, voice notes); the admin can switch them off per account. */
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  /** Set by the session-create hook (server/utils/auth.ts); sessions themselves go on sign-out. */
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const session = pgTable(
  'session',
  {
    id: id(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('session_user_idx').on(t.userId)],
)

export const account = pgTable(
  'account',
  {
    id: id(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
)

export const verification = pgTable('verification', {
  id: id(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// better-auth rate limiter storage (database mode, shared across instances)
export const rateLimit = pgTable('rate_limit', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  key: text('key').notNull(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

// ---- domain tables ---------------------------------------------------------

const userRef = () =>
  uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })

export const documents = pgTable(
  'documents',
  {
    id: id(),
    userId: userRef(),
    clientId: clientId(),
    status: text('status', { enum: ['reading', 'review', 'manual', 'confirmed'] })
      .notNull()
      .default('reading'),
    supplierName: text('supplier_name'),
    supplierNif: text('supplier_nif'),
    number: text('number'),
    issuedAt: date('issued_at', { mode: 'string' }),
    totalCents: integer('total_cents'),
    qrRaw: text('qr_raw'),
    extracted: jsonb('extracted'),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('documents_user_client_uq').on(t.userId, t.clientId)],
)

export const documentFiles = pgTable(
  'document_files',
  {
    id: id(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: userRef(),
    page: integer('page').notNull().default(1),
    mime: text('mime').notNull(),
    bytes: bytea('bytes').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('document_files_user_sha_uq').on(t.userId, t.sha256), index('document_files_doc_idx').on(t.documentId)],
)

export const bikes = pgTable(
  'bikes',
  {
    id: id(),
    userId: userRef(),
    clientId: clientId(),
    name: text('name').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    year: integer('year').notNull(),
    stroke: text('stroke', { enum: ['2T', '4T'] }).notNull(),
    meters: text('meters', { enum: ['hours_km', 'km', 'hours'] }).notNull().default('hours_km'),
    premixRatio: integer('premix_ratio'),
    photoDocumentId: uuid('photo_document_id').references(() => documents.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('bikes_user_client_uq').on(t.userId, t.clientId), index('bikes_user_idx').on(t.userId)],
)

export const meterReadings = pgTable(
  'meter_readings',
  {
    id: id(),
    bikeId: uuid('bike_id')
      .notNull()
      .references(() => bikes.id, { onDelete: 'cascade' }),
    userId: userRef(),
    clientId: clientId(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    hoursTenths: integer('hours_tenths'),
    km: integer('km'),
    condition: text('condition', { enum: ['normal', 'mud', 'sand', 'dust', 'race'] })
      .notNull()
      .default('normal'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('meter_readings_user_client_uq').on(t.userId, t.clientId),
    index('meter_readings_bike_idx').on(t.bikeId, t.at),
  ],
)

export type ConditionMultipliers = { mud?: number; sand?: number; dust?: number; race?: number }

export const maintenanceItems = pgTable(
  'maintenance_items',
  {
    id: id(),
    bikeId: uuid('bike_id')
      .notNull()
      .references(() => bikes.id, { onDelete: 'cascade' }),
    userId: userRef(),
    clientId: clientId(),
    name: text('name').notNull(),
    everyHoursTenths: integer('every_hours_tenths'),
    everyKm: integer('every_km'),
    everyMonths: integer('every_months'),
    conditionMultipliers: jsonb('condition_multipliers')
      .$type<ConditionMultipliers>()
      .notNull()
      .default({}),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('maintenance_items_user_client_uq').on(t.userId, t.clientId),
    index('maintenance_items_bike_idx').on(t.bikeId),
  ],
)

export const services = pgTable(
  'services',
  {
    id: id(),
    bikeId: uuid('bike_id')
      .notNull()
      .references(() => bikes.id, { onDelete: 'cascade' }),
    userId: userRef(),
    clientId: clientId(),
    at: date('at', { mode: 'string' }).notNull(),
    /** Set-up record where the rider knew the meters but not the date: `at` is the set-up day, not a real date. */
    atUnknown: boolean('at_unknown').notNull().default(false),
    hoursTenths: integer('hours_tenths'),
    km: integer('km'),
    by: text('by', { enum: ['diy', 'garage'] }).notNull().default('diy'),
    garageName: text('garage_name'),
    notes: text('notes'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('services_user_client_uq').on(t.userId, t.clientId),
    index('services_bike_idx').on(t.bikeId),
  ],
)

export const serviceItems = pgTable(
  'service_items',
  {
    id: id(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => maintenanceItems.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('service_items_uq').on(t.serviceId, t.itemId), index('service_items_item_idx').on(t.itemId)],
)

export const categoryKinds = [
  'maintenance',
  'parts',
  'tyres',
  'fuel',
  'oil',
  'race',
  'insurance',
  'upgrades',
  'gear',
  'labour',
  'other',
] as const

export const categories = pgTable(
  'categories',
  {
    id: id(),
    userId: userRef(),
    clientId: clientId(),
    name: text('name').notNull(),
    kind: text('kind', { enum: categoryKinds }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('categories_user_client_uq').on(t.userId, t.clientId), index('categories_user_idx').on(t.userId)],
)

export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    userId: userRef(),
    clientId: clientId(),
    bikeId: uuid('bike_id').references(() => bikes.id, { onDelete: 'set null' }),
    at: date('at', { mode: 'string' }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    description: text('description').notNull().default(''),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    documentLine: integer('document_line'),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('expenses_user_client_uq').on(t.userId, t.clientId),
    index('expenses_user_at_idx').on(t.userId, t.at),
  ],
)

export const expenseItems = pgTable(
  'expense_items',
  {
    id: id(),
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => maintenanceItems.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('expense_items_uq').on(t.expenseId, t.itemId), index('expense_items_item_idx').on(t.itemId)],
)

export const reminders = pgTable(
  'reminders',
  {
    id: id(),
    userId: userRef(),
    clientId: clientId(),
    bikeId: uuid('bike_id').references(() => bikes.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    repeatYearly: boolean('repeat_yearly').notNull().default(false),
    doneAt: timestamp('done_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('reminders_user_client_uq').on(t.userId, t.clientId), index('reminders_user_idx').on(t.userId)],
)

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: id(),
  userId: userRef(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  /** IANA zone sent by the client at subscribe time; null → Europe/Lisbon. */
  timezone: text('timezone'),
  /** App language of the device ('en' | 'pt'), sent at subscribe time; null → English. */
  locale: text('locale'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// Dedupe ledger: a key is pushed at most once per user (nudge:<isoWeek> is shared by all users).
export const notificationsSent = pgTable(
  'notifications_sent',
  {
    id: id(),
    userId: userRef(),
    key: text('key').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('notifications_sent_user_key_uq').on(t.userId, t.key)],
)

// ---- item notes ------------------------------------------------------------

/** A label/value line on a note: "Axle nut · 90 Nm", "Oil · 0.8 L Motorex 10W-50". */
export type NoteSpec = { label: string; value: string }

/** The rider's own notes on a maintenance item: how-to, torque specs, parts, photos. */
export const itemNotes = pgTable(
  'item_notes',
  {
    id: id(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => maintenanceItems.id, { onDelete: 'cascade' }),
    userId: userRef(),
    clientId: clientId(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    specs: jsonb('specs').$type<NoteSpec[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('item_notes_user_client_uq').on(t.userId, t.clientId), index('item_notes_item_idx').on(t.itemId)],
)

export const itemNotePhotos = pgTable(
  'item_note_photos',
  {
    id: id(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => itemNotes.id, { onDelete: 'cascade' }),
    userId: userRef(),
    clientId: clientId(),
    mime: text('mime').notNull(),
    bytes: bytea('bytes').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('item_note_photos_user_client_uq').on(t.userId, t.clientId), index('item_note_photos_note_idx').on(t.noteId)],
)

// ---- Shelf: spare parts in stock -------------------------------------------

export type MovementKind = 'bought' | 'used' | 'adjust'

/** A spare part on the shelf. `qtyHundredths` always equals the sum of its movements (may go negative). */
export const parts = pgTable(
  'parts',
  {
    id: id(),
    userId: userRef(),
    clientId: clientId(),
    bikeId: uuid('bike_id').references(() => bikes.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    unit: text('unit').notNull().default('pcs'),
    qtyHundredths: integer('qty_hundredths').notNull().default(0),
    minHundredths: integer('min_hundredths'),
    notes: text('notes'),
    /** The saved invoice whose line created this part; Delete of that invoice may remove it. */
    createdByDocumentId: uuid('created_by_document_id').references(() => documents.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('parts_user_client_uq').on(t.userId, t.clientId), index('parts_user_idx').on(t.userId)],
)

/** Which maintenance items a part fits. */
export const partItems = pgTable(
  'part_items',
  {
    partId: uuid('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => maintenanceItems.id, { onDelete: 'cascade' }),
  },
  (t) => [unique('part_items_pair_uq').on(t.partId, t.itemId)],
)

/** Every change to a part's count; name and unit are snapshots so history survives renames and deletes. */
export const partMovements = pgTable(
  'part_movements',
  {
    id: id(),
    userId: userRef(),
    clientId: clientId(),
    partId: uuid('part_id').references(() => parts.id, { onDelete: 'set null' }),
    partName: text('part_name').notNull(),
    unit: text('unit').notNull(),
    kind: text('kind').$type<MovementKind>().notNull(),
    qtyHundredths: integer('qty_hundredths').notNull(),
    at: date('at', { mode: 'string' }).notNull(),
    expenseId: uuid('expense_id').references(() => expenses.id, { onDelete: 'set null' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('part_movements_user_client_uq').on(t.userId, t.clientId),
    index('part_movements_part_idx').on(t.partId),
    index('part_movements_service_idx').on(t.serviceId),
  ],
)

/** Manual shopping-list lines; ticked by a 'bought' movement on the linked part. */
export const shoppingEntries = pgTable(
  'shopping_entries',
  {
    id: id(),
    userId: userRef(),
    clientId: clientId(),
    text: text('text').notNull(),
    bikeId: uuid('bike_id').references(() => bikes.id, { onDelete: 'set null' }),
    partId: uuid('part_id').references(() => parts.id, { onDelete: 'set null' }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('shopping_entries_user_client_uq').on(t.userId, t.clientId)],
)

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: id(),
    userId: userRef(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    tokenPrefix: text('token_prefix').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId), index('api_tokens_hash_idx').on(t.tokenHash)],
)

export type ApiToken = typeof apiTokens.$inferSelect
export type Part = typeof parts.$inferSelect
export type PartMovement = typeof partMovements.$inferSelect
export type ShoppingEntry = typeof shoppingEntries.$inferSelect

export type Bike = typeof bikes.$inferSelect
export type MaintenanceItem = typeof maintenanceItems.$inferSelect
export type Document = typeof documents.$inferSelect
export type Expense = typeof expenses.$inferSelect
export type Service = typeof services.$inferSelect
export type Category = typeof categories.$inferSelect
export type Reminder = typeof reminders.$inferSelect
export type ItemNote = typeof itemNotes.$inferSelect
