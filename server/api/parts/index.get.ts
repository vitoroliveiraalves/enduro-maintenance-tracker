import { defineEventHandler } from 'h3'
import { requireUser } from '../../utils/require-user'
import { listPartRows } from '../../utils/parts'

export default defineEventHandler(async (event) => listPartRows((await requireUser(event)).id))
