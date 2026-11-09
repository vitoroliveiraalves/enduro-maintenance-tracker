import { defineEventHandler } from 'h3'
import { requireUser } from '../../utils/require-user'
import { shoppingList } from '../../utils/shopping'

export default defineEventHandler(async (event) => shoppingList((await requireUser(event)).id))
