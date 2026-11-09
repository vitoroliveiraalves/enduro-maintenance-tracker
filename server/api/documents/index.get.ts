import { defineEventHandler } from 'h3'
import { requireUser } from '../../utils/require-user'
import { listDocuments } from '../../utils/invoice-list'

export default defineEventHandler(async (event) => listDocuments((await requireUser(event)).id))
