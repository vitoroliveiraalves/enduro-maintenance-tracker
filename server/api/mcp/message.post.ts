import { createError, defineEventHandler, getQuery } from 'h3'
import { getMcpSession } from '../../utils/mcp-session'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const sessionId = typeof query.sessionId === 'string' ? query.sessionId : null

  if (!sessionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing sessionId parameter',
    })
  }

  const session = getMcpSession(sessionId)
  if (!session) {
    throw createError({
      statusCode: 404,
      statusMessage: 'MCP session not found or expired',
    })
  }

  await session.transport.handlePostMessage(event.node.req, event.node.res)
})
