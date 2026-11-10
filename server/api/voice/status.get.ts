import { defineEventHandler } from 'h3'
import { aiEnabled } from '../../utils/admin'
import { requireUser } from '../../utils/require-user'
import { voiceAvailable, voiceConfig } from '../../utils/voice'

/** Whether the mic is shown: a key (or the e2e mock) is configured and AI is on for this account. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const setUp = voiceAvailable(voiceConfig(event))
  const off = setUp && !(await aiEnabled(user.id))
  return { available: setUp && !off, off }
})
