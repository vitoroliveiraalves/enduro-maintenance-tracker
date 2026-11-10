import { defineEventHandler } from 'h3'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { createMcpServer } from '../../utils/mcp-server'
import { registerMcpSession, removeMcpSession, requireMcpAuth } from '../../utils/mcp-session'

export default defineEventHandler(async (event) => {
  const auth = await requireMcpAuth(event)

  const server = createMcpServer(auth.userId)
  const transport = new SSEServerTransport('/api/mcp/message', event.node.res)

  const session = {
    transport,
    server,
    userId: auth.userId,
    tokenId: auth.tokenId,
    createdAt: Date.now(),
  }

  registerMcpSession(session)

  event.node.res.on('close', () => {
    removeMcpSession(transport.sessionId)
  })

  await server.connect(transport)
})
