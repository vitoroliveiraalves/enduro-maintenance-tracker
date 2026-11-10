import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { apiTokens, user } from '../../../server/db/schema'
import {
  authenticateToken,
  createApiToken,
  hashToken,
  listApiTokens,
  MAX_TOKENS_PER_USER,
  revokeApiToken,
  TOKEN_PREFIX,
} from '../../../server/utils/tokens'
import { truncateUsers } from '../../support/truncate'

let userA: string
let userB: string

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
})

describe('API Tokens', () => {
  describe('createApiToken', () => {
    it('creates a token with valid prefix and hashes it in the database', async () => {
      const created = await createApiToken(userA, 'Gemini Mobile')
      expect(created.name).toBe('Gemini Mobile')
      expect(created.token.startsWith(TOKEN_PREFIX)).toBe(true)
      expect(created.tokenPrefix).toBe(created.token.slice(0, 14))

      // Check DB does NOT store the raw secret
      const [inDb] = await db.select().from(apiTokens).where(eq(apiTokens.id, created.id))
      expect(inDb).toBeDefined()
      expect(inDb!.tokenHash).toBe(hashToken(created.token))
      expect(inDb!.tokenHash).not.toBe(created.token)
    })

    it('rejects empty or whitespace-only token names', async () => {
      await expect(createApiToken(userA, '')).rejects.toThrow('Token name is required')
      await expect(createApiToken(userA, '   ')).rejects.toThrow('Token name is required')
      await expect(createApiToken(userA, null)).rejects.toThrow('Token name is required')
    })

    it('enforces maximum tokens per user cap', async () => {
      for (let i = 0; i < MAX_TOKENS_PER_USER; i++) {
        await createApiToken(userA, `Token ${i}`)
      }
      await expect(createApiToken(userA, 'One Too Many')).rejects.toThrow(
        `Maximum limit of ${MAX_TOKENS_PER_USER} access tokens reached.`,
      )
    })
  })

  describe('listApiTokens', () => {
    it('lists only tokens for the requesting user, omitting secret and hash', async () => {
      const t1 = await createApiToken(userA, 'T1')
      const t2 = await createApiToken(userA, 'T2')
      await createApiToken(userB, 'B Token')

      const listA = await listApiTokens(userA)
      expect(listA).toHaveLength(2)
      expect(listA.map((t) => t.id)).toEqual([t2.id, t1.id]) // Newest first
      expect(listA[0]).toHaveProperty('name', 'T2')
      expect(listA[0]).toHaveProperty('tokenPrefix')
      expect((listA[0] as unknown as { token?: string }).token).toBeUndefined()
      expect((listA[0] as unknown as { tokenHash?: string }).tokenHash).toBeUndefined()

      const listB = await listApiTokens(userB)
      expect(listB).toHaveLength(1)
      expect(listB[0]!.name).toBe('B Token')
    })
  })

  describe('revokeApiToken', () => {
    it('revokes an owned token', async () => {
      const t = await createApiToken(userA, 'Revoke Me')
      const revoked = await revokeApiToken(userA, t.id)
      expect(revoked).toBe(true)

      const remaining = await listApiTokens(userA)
      expect(remaining).toHaveLength(0)
    })

    it('cannot revoke another user token', async () => {
      const tA = await createApiToken(userA, 'A Token')
      const revoked = await revokeApiToken(userB, tA.id)
      expect(revoked).toBe(false)

      const remaining = await listApiTokens(userA)
      expect(remaining).toHaveLength(1)
    })
  })

  describe('authenticateToken', () => {
    it('authenticates a valid token and returns user details', async () => {
      const created = await createApiToken(userA, 'Claude Desktop')
      const auth = await authenticateToken(created.token)

      expect(auth).not.toBeNull()
      expect(auth?.userId).toBe(userA)
      expect(auth?.tokenId).toBe(created.id)
      expect(auth?.userName).toBe('Rider A')
      expect(auth?.email).toBe('a@example.com')
    })

    it('rejects tokens with invalid prefix or bad formats', async () => {
      expect(await authenticateToken('invalid_token')).toBeNull()
      expect(await authenticateToken('bearer_123456789012345678901234567890')).toBeNull()
      expect(await authenticateToken(null)).toBeNull()
      expect(await authenticateToken('')).toBeNull()
      expect(await authenticateToken(`${TOKEN_PREFIX}tooshort`)).toBeNull()
    })

    it('rejects a valid-looking token that does not exist in DB', async () => {
      const fakeToken = `${TOKEN_PREFIX}fake_non_existent_token_with_valid_length_123456789`
      expect(await authenticateToken(fakeToken)).toBeNull()
    })

    it('rejects a revoked token', async () => {
      const created = await createApiToken(userA, 'Temp Key')
      await revokeApiToken(userA, created.id)
      expect(await authenticateToken(created.token)).toBeNull()
    })
  })
})
