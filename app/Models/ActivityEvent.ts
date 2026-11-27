import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/** Local activity metadata. This model has no generated REST routes. */
export default defineModel({
  name: 'ActivityEvent',
  table: 'activity_events',
  primaryKey: 'id',
  autoIncrement: true,

  attributes: {
    kind: { order: 1, fillable: true, validation: { rule: schema.string().required().max(16) } },
    action: { order: 2, fillable: true, validation: { rule: schema.string().required().max(64) } },
    source: { order: 3, fillable: true, validation: { rule: schema.string().required().max(16) } },
    status: { order: 4, fillable: true, validation: { rule: schema.string().required().max(16) } },
    startedAt: { order: 5, fillable: true, validation: { rule: schema.number().required().min(0) } },
    finishedAt: { order: 6, fillable: true, default: 0, validation: { rule: schema.number().required().min(0) } },
    ownerPid: { order: 7, fillable: true, validation: { rule: schema.number().required().min(0) } },
  },
} as const)
