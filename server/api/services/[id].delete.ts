import { defineEventHandler, getRouterParam } from 'h3'
import { ownedService } from '../../utils/owned'
import { deleteService } from '../../utils/services'

export default defineEventHandler(async (event) => deleteService(await ownedService(event, getRouterParam(event, 'id') ?? '')))
