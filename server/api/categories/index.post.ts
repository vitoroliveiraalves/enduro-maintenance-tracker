import { defineEventHandler, readBody } from 'h3'
import { requireUser } from '../../utils/require-user'
import { createCategory } from '../../utils/categories'

export default defineEventHandler(async (event) => createCategory((await requireUser(event)).id, await readBody(event)))
