import { authClient } from '~/lib/auth-client'

const PUBLIC = ['/login', '/register']

export default defineNuxtRouteMiddleware(async (to) => {
  const isPublic = PUBLIC.includes(to.path)
  const { data } = await authClient.getSession()
  if (!data && !isPublic) return navigateTo('/login')
  if (data && isPublic) return navigateTo('/')
})
