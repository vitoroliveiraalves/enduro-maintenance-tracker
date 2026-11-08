import { defineEventHandler, getRouterParam } from 'h3'
import { ownedExpense } from '../../utils/owned'
import { deleteExpense } from '../../utils/expenses'

export default defineEventHandler(async (event) => {
  const expense = await ownedExpense(event, getRouterParam(event, 'id') ?? '')
  await deleteExpense(expense.userId, expense.id)
  return { ok: true }
})
