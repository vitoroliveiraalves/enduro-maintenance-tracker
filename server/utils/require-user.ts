import { createError, type H3Event } from 'h3'
import { auth } from './auth'

export async function requireUser(event: H3Event): Promise<{ id: string; email: string }> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return { id: session.user.id, email: session.user.email }
}
