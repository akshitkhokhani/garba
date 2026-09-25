import test from 'node:test'
import assert from 'node:assert/strict'

import { rollupDay } from '../rollup-worker.js'

const NOW = Date.parse('2026-09-10T08:00:00Z')
const DAY = '2026-09-09'

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = sql
    this.args = []
  }

  bind(...args) {
    const statement = new FakeStatement(this.db, this.sql)
    statement.args = args
    return statement
  }

  async run() {
    this.db.runs.push({ sql: this.sql, args: this.args })
    return { success: true }
  }

  async all() {
    return { success: true, results: [] }
  }
}

class FakeDb {
  constructor() {
    this.runs = []
    this.batches = []
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  async batch(statements) {
    this.batches.push(statements.map((statement) => ({ sql: statement.sql, args: statement.args })))
    return statements.map(() => ({ success: true }))
  }
}

function eventRow(overrides = {}) {
  return {
    unique_browsers: 4,
    sessions: 5,
    browser_ids_created: 2,
    confirmed_play_starts: 7,
    surface_views: 12,
    data_through_ms: NOW,
    max_sample_interval: 1,
    ...overrides,
  }
}

function listeningRow(overrides = {}) {
  return {
    played_ms: 90_000,
    data_through_ms: NOW - 1_000,
    max_sample_interval: 1,
    ...overrides,
  }
}

function queryFixture({ event = eventRow(), listening = listeningRow() } = {}) {
  return async (_env, sql) => sql.includes('played_ms') ? [listening] : [event]
}

function rollupStatuses(db) {
  return db.runs.map((run) => run.args[1])
}

function failedErrorCode(db) {
  const failed = db.runs.find((run) => run.args[1] === 'failed')
  return failed?.args[4] ?? null
}

test('valid numeric rollup evidence preserves metrics and freshness', async () => {
  const db = new FakeDb()
  const result = await rollupDay({ DB: db }, DAY, {
    nowMs: NOW,
    queryAnalytics: queryFixture(),
  })

  assert.equal(result.status, 'complete')
  assert.deepEqual(result.metrics, {
    sessions: 5,
    confirmed_play_starts: 7,
    surface_views: 12,
    listening_ms: 90_000,
    unique_browsers_daily: 4,
    browser_ids_created: 2,
  })
  assert.equal(result.dataThroughMs, NOW)
  assert.deepEqual(rollupStatuses(db), ['running', 'complete'])
  assert.equal(db.batches.length, 1)
})

test('numeric zero remains valid metric and freshness evidence', async () => {
  const db = new FakeDb()
  const result = await rollupDay({ DB: db }, DAY, {
    nowMs: NOW,
    queryAnalytics: queryFixture({
      event: eventRow({
        unique_browsers: 0,
        sessions: 0,
        browser_ids_created: 0,
        confirmed_play_starts: 0,
        surface_views: 0,
        data_through_ms: 0,
      }),
      listening: listeningRow({ played_ms: 0, data_through_ms: 0 }),
    }),
  })

  assert.deepEqual(Object.values(result.metrics), [0, 0, 0, 0, 0, 0])
  assert.equal(result.dataThroughMs, 0)
  assert.deepEqual(rollupStatuses(db), ['running', 'complete'])
})

test('coercible, missing and non-finite metric evidence fails closed', async () => {
  const invalidValues = ['5', '', false, true, null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]

  for (const value of invalidValues) {
    const db = new FakeDb()
    await assert.rejects(
      rollupDay({ DB: db }, DAY, {
        nowMs: NOW,
        queryAnalytics: queryFixture({ event: eventRow({ sessions: value }) }),
      }),
      /invalid_rollup_metric:sessions/,
      `sessions=${String(value)} (${typeof value}) must fail closed`,
    )
    assert.deepEqual(rollupStatuses(db), ['running', 'failed'])
    assert.equal(db.batches.length, 0, 'invalid metric evidence must not replace durable daily metrics')
    assert.equal(failedErrorCode(db), 'invalid_rollup_metric:sessions')
  }
})

test('missing aggregate rows do not fabricate a zero-valued day', async () => {
  const db = new FakeDb()
  let call = 0
  const queryAnalytics = async () => {
    call += 1
    return call === 1 ? [] : [listeningRow()]
  }

  await assert.rejects(
    rollupDay({ DB: db }, DAY, { nowMs: NOW, queryAnalytics }),
    /invalid_rollup_metric:sessions/,
  )
  assert.deepEqual(rollupStatuses(db), ['running', 'failed'])
  assert.equal(db.batches.length, 0)
})

test('absent freshness is unknown, while malformed explicit freshness fails closed', async () => {
  for (const absent of [null, undefined]) {
    const db = new FakeDb()
    const result = await rollupDay({ DB: db }, DAY, {
      nowMs: NOW,
      queryAnalytics: queryFixture({
        event: eventRow({ data_through_ms: absent }),
        listening: listeningRow({ data_through_ms: absent }),
      }),
    })
    assert.equal(result.dataThroughMs, null)
    assert.deepEqual(rollupStatuses(db), ['running', 'complete'])
  }

  const invalidValues = ['0', '', false, true, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]
  for (const value of invalidValues) {
    const db = new FakeDb()
    await assert.rejects(
      rollupDay({ DB: db }, DAY, {
        nowMs: NOW,
        queryAnalytics: queryFixture({ event: eventRow({ data_through_ms: value }) }),
      }),
      /invalid_rollup_data_through:events/,
      `data_through_ms=${String(value)} (${typeof value}) must fail closed`,
    )
    assert.deepEqual(rollupStatuses(db), ['running', 'failed'])
    assert.equal(db.batches.length, 0)
    assert.equal(failedErrorCode(db), 'invalid_rollup_data_through:events')
  }
})

test('malformed listening freshness is rejected independently', async () => {
  const db = new FakeDb()
  await assert.rejects(
    rollupDay({ DB: db }, DAY, {
      nowMs: NOW,
      queryAnalytics: queryFixture({ listening: listeningRow({ data_through_ms: '123' }) }),
    }),
    /invalid_rollup_data_through:listening/,
  )
  assert.deepEqual(rollupStatuses(db), ['running', 'failed'])
  assert.equal(db.batches.length, 0)
})
