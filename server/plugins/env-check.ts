import { checkProductionEnv } from '../utils/env-check'

/** Fail fast on a misconfigured production deploy instead of serving 500s. */
export default defineNitroPlugin(() => {
  if (process.env.NODE_ENV !== 'production') return
  const { errors, warnings } = checkProductionEnv(process.env)
  for (const w of warnings) console.warn(`[config] ${w}`)
  if (errors.length) {
    for (const e of errors) console.error(`[config] ${e}`)
    console.error('[config] Refusing to start. See .env.example and README "Deploy".')
    process.exit(1)
  }
})
