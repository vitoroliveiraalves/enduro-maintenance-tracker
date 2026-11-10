import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../db/client'
import { apiTokens, user } from '../db/schema'
import { isUuid } from './validate'

export const TOKEN_PREFIX = 'dirt_pat_'
export const MAX_TOKENS_PER_USER = 20

export type TokenSummary = {
  id: string
  name: string
  tokenPrefix: string
  lastUsedAt: string | null
  createdAt: string
}

export type CreatedToken = TokenSummary & {
  token: string
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function createApiToken(userId: string, rawName: unknown): Promise<CreatedToken> {
  if (!isUuid(userId)) throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })

  const name = typeof rawName === 'string' ? rawName.trim().slice(0, 50) : ''
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Token name is required' })

  const existing = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))

  if (existing.length >= MAX_TOKENS_PER_USER) {
    throw createError({ statusCode: 400, statusMessage: `Maximum limit of ${MAX_TOKENS_PER_USER} access tokens reached.` })
  }

  // 32 random bytes -> 43 base64url characters (~256 bits entropy)
  const secret = randomBytes(32).toString('base64url')
  const rawToken = `${TOKEN_PREFIX}${secret}`
  const tokenHash = hashToken(rawToken)
  const tokenPrefix = rawToken.slice(0, 14) // e.g. "dirt_pat_abc12"

  const [row] = await db
    .insert(apiTokens)
    .values({
      userId,
      name,
      tokenHash,
      tokenPrefix,
    })
    .returning({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })

  if (!row) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to create access token' })
  }

  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    token: rawToken,
  }
}

export async function listApiTokens(userId: string): Promise<TokenSummary[]> {
  if (!isUuid(userId)) return []

  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt))

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tokenPrefix: r.tokenPrefix,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }))
}

export async function revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
  if (!isUuid(userId) || !isUuid(tokenId)) return false

  const result = await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
    .returning({ id: apiTokens.id })

  return result.length > 0
}

export async function authenticateToken(rawToken: unknown): Promise<{ userId: string; tokenId: string; userName: string; email: string } | null> {
  if (typeof rawToken !== 'string' || !rawToken.startsWith(TOKEN_PREFIX) || rawToken.length < 30 || rawToken.length > 100) {
    return null
  }

  const candHash = hashToken(rawToken)
  const [row] = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      tokenHash: apiTokens.tokenHash,
      userName: user.name,
      email: user.email,
    })
    .from(apiTokens)
    .innerJoin(user, eq(apiTokens.userId, user.id))
    .where(eq(apiTokens.tokenHash, candHash))

  if (!row) return null

  // Constant-time comparison
  const a = Buffer.from(candHash, 'hex')
  const b = Buffer.from(row.tokenHash, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  // Fire-and-forget lastUsedAt update (do not block execution)
  db.update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id))
    .catch((err) => console.error('[token] failed updating lastUsedAt', err))

  return {
    userId: row.userId,
    tokenId: row.id,
    userName: row.userName,
    email: row.email,
  }
}
