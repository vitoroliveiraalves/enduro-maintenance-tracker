import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ownedExpense } from '../../utils/owned'
import { patchExpense } from '../../utils/expenses'

export default defineEventHandler(async (event) => {
  const expense = await ownedExpense(event, getRouterParam(event, 'id') ?? '')
  return patchExpense(expense.userId, expense, await readBody(event))
})
