import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import { app } from './index'

const store = path.join(process.cwd(), 'data', 'store.json')
beforeEach(() => { if (fs.existsSync(store)) fs.rmSync(store); })

describe('critical operational behaviors', () => {
  it('prevents an operator from creating work for another team', async () => {
    const response = await request(app).post('/api/work-items').set('x-user-id', 'u-noah').send({ title: 'Payment review', description: 'Investigate', teamId: 'team-fin' })
    expect(response.status).toBe(400)
  })
  it('rejects stale edits with the current server version', async () => {
    const created = await request(app).post('/api/work-items').set('x-user-id', 'u-noah').send({ title: 'Incident', description: 'Investigate', teamId: 'team-eng' })
    const first = await request(app).patch(`/api/work-items/${created.body.id}`).set('x-user-id', 'u-noah').set('if-match-version', '1').send({ status: 'in_progress' })
    const stale = await request(app).patch(`/api/work-items/${created.body.id}`).set('x-user-id', 'u-noah').set('if-match-version', '1').send({ priority: 'critical' })
    expect(first.status).toBe(200); expect(stale.status).toBe(409); expect(stale.body.current.version).toBe(2)
  })
  it('makes repeated claims with one idempotency key return one result', async () => {
    const created = await request(app).post('/api/work-items').set('x-user-id', 'u-noah').send({ title: 'Queue item', description: 'Investigate', teamId: 'team-ops' })
    const first = await request(app).post(`/api/work-items/${created.body.id}/claim`).set('x-user-id', 'u-noah').set('idempotency-key', 'claim-once')
    const second = await request(app).post(`/api/work-items/${created.body.id}/claim`).set('x-user-id', 'u-noah').set('idempotency-key', 'claim-once')
    expect(first.status).toBe(200); expect(second.status).toBe(200); expect(second.body.version).toBe(first.body.version)
  })
  it('allows only one operator to claim an unassigned item', async () => {
    const created = await request(app).post('/api/work-items').set('x-user-id', 'u-noah').send({ title: 'Shared queue item', description: 'Investigate', teamId: 'team-ops' })
    const first = await request(app).post(`/api/work-items/${created.body.id}/claim`).set('x-user-id', 'u-noah').set('idempotency-key', 'noah-claim')
    const second = await request(app).post(`/api/work-items/${created.body.id}/claim`).set('x-user-id', 'u-ava').set('idempotency-key', 'ava-claim')
    expect(first.status).toBe(200); expect(second.status).toBe(409); expect(second.body.current.assigneeId).toBe('u-noah')
  })
  it('records status and priority decisions in history', async () => {
    const created = await request(app).post('/api/work-items').set('x-user-id', 'u-noah').send({ title: 'Decision trail', description: 'Investigate', teamId: 'team-ops' })
    const updated = await request(app).patch(`/api/work-items/${created.body.id}`).set('x-user-id', 'u-noah').set('if-match-version', '1').send({ status: 'resolved', priority: 'critical' })
    const detail = await request(app).get(`/api/work-items/${created.body.id}`).set('x-user-id', 'u-noah')
    expect(updated.status).toBe(200); expect(detail.body.audit[0].message).toContain('status changed'); expect(detail.body.audit[0].message).toContain('priority changed')
  })
})