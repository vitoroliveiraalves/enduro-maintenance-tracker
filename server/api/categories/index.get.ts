import { defineEventHandler } from 'h3'
import { requireUser } from '../../utils/require-user'
import { listCategories } from '../../utils/categories'

export default defineEventHandler(async (event) => listCategories((await requireUser(event)).id))
