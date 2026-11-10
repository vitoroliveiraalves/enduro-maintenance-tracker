import { randomUUID } from 'node:crypto'
import { defineEventHandler, getMethod, getRequestHeader, setHeader, setResponseStatus } from 'h3'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from '../../utils/mcp-server'
import { requireMcpAuth } from '../../utils/mcp-session'

type StreamableSession = {
  transport: StreamableHTTPServerTransport
  userId: string
  tokenId: string
  lastSeen: number
}

const streamableSessions = new Map<string, StreamableSession>()

// Clean up idle sessions after 1 hour
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of streamableSessions.entries()) {
    if (now - s.lastSeen > 60 * 60 * 1000) {
      s.transport.close().catch(() => {})
      streamableSessions.delete(id)
    }
  }
}, 5 * 60 * 1000).unref?.()

export default defineEventHandler(async (event) => {
  const method = getMethod(event).toUpperCase()

  // Always enable CORS for MCP clients (Gemini, Claude, browser tools)
  setHeader(event, 'Access-Control-Allow-Origin', '*')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE')
  setHeader(event, 'Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Accept, Last-Event-ID')
  setHeader(event, 'Access-Control-Expose-Headers', 'Mcp-Session-Id')

  if (method === 'OPTIONS') {
    setHeader(event, 'WWW-Authenticate', 'Bearer realm="Dirt Garage"')
    setResponseStatus(event, 204)
    return ''
  }

  // Authenticate request (supports Bearer token in header or ?token=)
  let auth
  try {
    auth = await requireMcpAuth(event)
  } catch (err) {
    // Advertise Bearer token authentication to MCP connector discovery wizards
    setHeader(event, 'WWW-Authenticate', 'Bearer realm="Dirt Garage"')
    throw err
  }

  const incomingSessionId = getRequestHeader(event, 'mcp-session-id')
  let session = incomingSessionId ? streamableSessions.get(incomingSessionId) : undefined

  // GET probe / healthcheck without active session
  if (method === 'GET' && !incomingSessionId) {
    return {
      status: 'ok',
      service: 'dirt-garage-mcp',
      transport: 'streamable-http',
      version: '1.0.0',
      authenticatedAs: auth.userName,
    }
  }

  // New session initialization
  if (!session) {
    const server = createMcpServer(auth.userId)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    })

    await server.connect(transport)
    session = {
      transport,
      userId: auth.userId,
      tokenId: auth.tokenId,
      lastSeen: Date.now(),
    }
  } else {
    session.lastSeen = Date.now()
  }

  await session.transport.handleRequest(event.node.req, event.node.res)

  // Save session once sessionId is generated
  if (session.transport.sessionId) {
    streamableSessions.set(session.transport.sessionId, session)
  }
})
