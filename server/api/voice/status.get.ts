import { defineEventHandler } from 'h3'
import { requireUser } from '../../utils/require-user'
import { voiceAvailable, voiceConfig } from '../../utils/voice'

/** Whether the mic is shown: a key (or the e2e mock) is configured. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return { available: voiceAvailable(voiceConfig(event)) }
})
