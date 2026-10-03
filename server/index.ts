import cors from 'cors'
import express, { type Request } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

type Role = 'operator' | 'manager' | 'admin'
type Status = 'open' | 'in_progress' | 'blocked' | 'resolved'
type Priority = 'critical' | 'high' | 'normal' | 'low'

type User = { id: string; name: string; email: string; teamIds: string[]; role: Role }
type Team = { id: string; name: string; color: string }
type WorkItem = {
  id: string; title: string; description: string; status: Status; priority: Priority
  teamId: string; assigneeId: string | null; createdBy: string; version: number
  createdAt: string; updatedAt: string; dueAt: string | null
}
type AuditEvent = { id: string; workItemId: string; actorId: string; type: string; message: string; createdAt: string }
type NotificationJob = { id: string; workItemId: string; type: string; attempts: number; status: 'pending' | 'sent' | 'failed' }
type Database = { users: User[]; teams: Team[]; workItems: WorkItem[]; audit: AuditEvent[]; jobs: NotificationJob[]; idempotency: Record<string, unknown> }

const dataPath = path.join(process.cwd(), 'data', 'store.json')
const initial: Database = {
  teams: [{ id: 'team-ops', name: 'Operations', color: '#e8794f' }, { id: 'team-eng', name: 'Engineering', color: '#4f8fe8' }, { id: 'team-fin', name: 'Finance', color: '#55a875' }],
  users: [
    { id: 'u-ava', name: 'Ava Patel', email: 'ava@newtonite.local', teamIds: ['team-ops'], role: 'manager' },
    { id: 'u-noah', name: 'Noah Williams', email: 'noah@newtonite.local', teamIds: ['team-ops', 'team-eng'], role: 'operator' },
    { id: 'u-maya', name: 'Maya Chen', email: 'maya@newtonite.local', teamIds: ['team-fin'], role: 'operator' },
    { id: 'u-root', name: 'Ravi Singh', email: 'ravi@newtonite.local', teamIds: ['team-ops', 'team-eng', 'team-fin'], role: 'admin' },
  ], workItems: [], audit: [], jobs: [], idempotency: {},
}

function load(): Database {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true })
  if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, JSON.stringify(initial, null, 2))
  const db = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as Database
  if (db.workItems.length === 0) {
    const timestamp = now()
    db.workItems = [
      { id: 'work-demo-1', title: 'Refund request needs approval', description: 'A customer refund is above the automatic threshold and needs a documented decision before payout.', status: 'open', priority: 'critical', teamId: 'team-ops', assigneeId: null, createdBy: 'u-ava', version: 1, createdAt: timestamp, updatedAt: timestamp, dueAt: null },
      { id: 'work-demo-2', title: 'Investigate elevated API latency', description: 'The checkout API crossed the response-time alert threshold for three consecutive windows.', status: 'in_progress', priority: 'high', teamId: 'team-eng', assigneeId: 'u-noah', version: 2, createdAt: timestamp, updatedAt: timestamp, dueAt: null },
      { id: 'work-demo-3', title: 'Vendor invoice mismatch', description: 'The latest invoice total does not match the approved purchase order.', status: 'blocked', priority: 'normal', teamId: 'team-fin', assigneeId: null, createdBy: 'u-maya', version: 1, createdAt: timestamp, updatedAt: timestamp, dueAt: null },
    ]
    db.audit = [{ id: 'audit-demo-1', workItemId: 'work-demo-2', actorId: 'u-noah', type: 'claimed', message: 'Claimed by Noah Williams', createdAt: timestamp }]
    save(db)
  }
  return db
}
function save(db: Database) { fs.writeFileSync(dataPath, JSON.stringify(db, null, 2)) }
function now() { return new Date().toISOString() }
function id(prefix: string) { return `${prefix}-${crypto.randomUUID().slice(0, 8)}` }
function actor(req: Request, db: Database) { return db.users.find((user) => user.id === (req.header('x-user-id') ?? 'u-ava')) ?? null }
function canAccess(user: User, item: WorkItem) { return user.role === 'admin' || user.teamIds.includes(item.teamId) }
function canEdit(user: User, item: WorkItem) { return canAccess(user, item) && (user.role !== 'operator' || item.assigneeId === user.id || item.assigneeId === null) }
function record(db: Database, item: WorkItem, user: User, type: string, message: string) { db.audit.unshift({ id: id('audit'), workItemId: item.id, actorId: user.id, type, message, createdAt: now() }) }

export const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/bootstrap', (_req, res) => { const db = load(); res.json({ users: db.users, teams: db.teams }) })
app.get('/api/work-items', (req, res) => {
  const db = load(); const user = actor(req, db)!; const query = String(req.query.q ?? '').toLowerCase(); const status = String(req.query.status ?? 'all'); const priority = String(req.query.priority ?? 'all')
  const page = Math.max(1, Number(req.query.page ?? 1)); const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 20)))
  const priorityRank: Record<string, number> = { critical: 4, high: 3, normal: 2, low: 1 }
  const visible = db.workItems.filter((item) => canAccess(user, item) && (status === 'all' || item.status === status) && (priority === 'all' || item.priority === priority) && (!query || `${item.title} ${item.description}`.toLowerCase().includes(query))).sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority] || b.updatedAt.localeCompare(a.updatedAt))
  const start = (page - 1) * pageSize; res.json({ items: visible.slice(start, start + pageSize), total: visible.length, page, pageSize })
})
app.post('/api/work-items', (req, res) => {
  const db = load(); const user = actor(req, db)!; const { title, description, teamId, priority = 'normal', dueAt = null } = req.body
  if (!title || !description || !db.teams.some((team) => team.id === teamId) || !user.teamIds.includes(teamId)) return res.status(400).json({ error: 'A title, description, and one of your teams are required.' })
  const timestamp = now(); const item: WorkItem = { id: id('work'), title, description, status: 'open', priority, teamId, assigneeId: null, createdBy: user.id, version: 1, createdAt: timestamp, updatedAt: timestamp, dueAt }
  db.workItems.unshift(item); record(db, item, user, 'created', 'Created work item'); save(db); res.status(201).json(item)
})
app.get('/api/work-items/:id', (req, res) => { const db = load(); const user = actor(req, db)!; const item = db.workItems.find((entry) => entry.id === req.params.id); if (!item || !canAccess(user, item)) return res.status(404).json({ error: 'Work item not found.' }); res.json({ item, audit: db.audit.filter((event) => event.workItemId === item.id), jobs: db.jobs.filter((job) => job.workItemId === item.id) }) })
app.patch('/api/work-items/:id', (req, res) => {
  const db = load(); const user = actor(req, db)!; const item = db.workItems.find((entry) => entry.id === req.params.id)
  if (!item || !canAccess(user, item)) return res.status(404).json({ error: 'Work item not found.' })
  if (!canEdit(user, item)) return res.status(403).json({ error: 'Operators can only edit unassigned work or work assigned to themselves.' })
  const expected = Number(req.header('if-match-version') ?? req.body.version); if (expected !== item.version) return res.status(409).json({ error: 'This work item changed while you were viewing it.', current: item })
  const changes = req.body as Partial<WorkItem>; const labels: string[] = []
  if (changes.teamId && (!db.teams.some((team) => team.id === changes.teamId) || !user.teamIds.includes(changes.teamId))) return res.status(403).json({ error: 'You can only move work into one of your teams.' })
  if (changes.status && !['open', 'in_progress', 'blocked', 'resolved'].includes(changes.status)) return res.status(400).json({ error: 'Invalid workflow status.' })
  if (changes.priority && !['critical', 'high', 'normal', 'low'].includes(changes.priority)) return res.status(400).json({ error: 'Invalid priority.' })
  for (const field of ['title', 'description', 'status', 'priority', 'teamId', 'assigneeId', 'dueAt'] as const) { if (changes[field] !== undefined && changes[field] !== item[field]) { labels.push(`${field} changed`); item[field] = changes[field] as never } }
  if (changes.assigneeId && (!db.users.some((entry) => entry.id === changes.assigneeId) || !db.users.find((entry) => entry.id === changes.assigneeId)!.teamIds.includes(item.teamId))) return res.status(400).json({ error: 'Assignee must belong to the work item team.' })
  item.version += 1; item.updatedAt = now(); record(db, item, user, 'updated', labels.join(', ') || 'Saved work item');
  if (changes.assigneeId) db.jobs.push({ id: id('job'), workItemId: item.id, type: 'assignment-notification', attempts: 0, status: 'pending' })
  save(db); res.json(item)
})
app.post('/api/work-items/:id/claim', (req, res) => {
  const db = load(); const user = actor(req, db)!; const key = req.header('idempotency-key'); const item = db.workItems.find((entry) => entry.id === req.params.id)
  if (!item || !canAccess(user, item)) return res.status(404).json({ error: 'Work item not found.' }); if (key && db.idempotency[key]) return res.json(db.idempotency[key])
  if (item.assigneeId && item.assigneeId !== user.id) return res.status(409).json({ error: 'This item is already owned by another operator.', current: item })
  item.assigneeId = user.id; item.status = 'in_progress'; item.version += 1; item.updatedAt = now(); record(db, item, user, 'claimed', `Claimed by ${user.name}`); const result = { ...item }; if (key) db.idempotency[key] = result; save(db); res.json(result)
})
function processNotificationJobs() {
  const db = load(); let changed = false
  for (const job of db.jobs.filter((entry) => entry.status === 'pending')) {
    job.attempts += 1
    job.status = job.attempts >= 3 ? 'failed' : 'sent'
    changed = true
  }
  if (changed) save(db)
}
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

if (process.env.NODE_ENV !== 'test') { app.listen(4000, () => console.log('Newtonite API listening on http://localhost:4000')); setInterval(processNotificationJobs, 5000) }