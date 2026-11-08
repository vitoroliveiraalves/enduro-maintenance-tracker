import { defineEventHandler } from 'h3'
import { requireUser } from '../../utils/require-user'
import { listBikes } from '../../utils/bikes'

export default defineEventHandler(async (event) => listBikes((await requireUser(event)).id))
