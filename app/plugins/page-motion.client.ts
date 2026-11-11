import { getNavigationDirection } from '~/lib/navigation-motion'

export default defineNuxtPlugin(() => {
  const router = useRouter()

  router.beforeEach((to, from) => {
    const dir = getNavigationDirection(from.path, to.path)
    document.documentElement.setAttribute('data-direction', dir)
  })
})
