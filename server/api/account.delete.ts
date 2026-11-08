import { createError, defineEventHandler, deleteCookie, readBody } from 'h3'
import { requireUser } from '../utils/require-user'
import { deleteAccount } from '../utils/account'

const AUTH_COOKIES = ['session_token', 'session_data', 'dont_remember']

/** Body `{ confirm: 'DELETE' }`. Deletes the user (everything cascades), then the session cookie. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody(event)
  if (body?.confirm !== 'DELETE') throw createError({ statusCode: 400, statusMessage: 'Type DELETE to confirm' })
  await deleteAccount(user.id) // session rows cascade with the user
  for (const name of AUTH_COOKIES) {
    deleteCookie(event, `better-auth.${name}`, { path: '/' })
    deleteCookie(event, `__Secure-better-auth.${name}`, { path: '/', secure: true })
  }
  return { ok: true }
})
