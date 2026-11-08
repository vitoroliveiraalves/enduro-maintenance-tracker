import { runNotify, vapidFrom, webPushSender } from '../utils/push'

/** Hourly due-check (nuxt.config → nitro.scheduledTasks). */
export default defineTask({
  meta: { name: 'notify', description: 'Push due maintenance, reminders and the weekly nudge' },
  async run() {
    const v = vapidFrom(useRuntimeConfig())
    if (!v) return { result: 'push not configured' }
    const r = await runNotify({ now: new Date(), send: webPushSender(v) })
    return { result: `${r.sent} sent to ${r.users} users` }
  },
})
