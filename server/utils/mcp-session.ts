import type { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createError, getQuery, getRequestHeader, type H3Event } from 'h3'
import { authenticateToken } from './tokens'
import { rateLimit } from './rate-limit'

export type McpSession = {
  transport: SSEServerTransport
  server: McpServer
  userId: string
  tokenId: string
  createdAt: number
}

const activeSessions = new Map<string, McpSession>()

const SESSION_TTL_MS = 60 * 60 * 1000 // 1 hour max idle

export function registerMcpSession(session: McpSession): void {
  activeSessions.set(session.transport.sessionId, session)
}

export function getMcpSession(sessionId: string): McpSession | undefined {
  return activeSessions.get(sessionId)
}

export function removeMcpSession(sessionId: string): void {
  activeSessions.delete(sessionId)
}

// Periodically clean up dead sessions
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of activeSessions.entries()) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      s.transport.close().catch(() => {})
      activeSessions.delete(id)
    }
  }
}, 5 * 60 * 1000).unref?.()

/**
 * Extract token from Authorization header (Bearer dirt_pat_...) or query parameter (?token=dirt_pat_...).
 * Returns authenticated user and token ID, or throws 401.
 */
export async function requireMcpAuth(event: H3Event): Promise<{ userId: string; tokenId: string; userName: string }> {
  let token: string | null = null

  const authHeader = getRequestHeader(event, 'authorization')
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim()
  } else {
    const q = getQuery(event)
    if (typeof q.token === 'string') {
      token = q.token.trim()
    }
  }

  if (!token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: missing Bearer token or token query parameter',
    })
  }

  const authenticated = await authenticateToken(token)
  if (!authenticated) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: invalid or revoked token',
    })
  }

  // Rate limiting: max 120 calls per minute per token
  const wait = rateLimit(`mcp:${authenticated.tokenId}`, 120, 60_000)
  if (wait !== null) {
    throw createError({
      statusCode: 429,
      statusMessage: `Too many MCP requests: please wait ${wait} seconds`,
    })
  }

  return {
    userId: authenticated.userId,
    tokenId: authenticated.tokenId,
    userName: authenticated.userName,
  }
}
