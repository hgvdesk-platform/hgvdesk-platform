/**
 * HGV PLATFORM — DATABASE
 * PostgreSQL connection + full schema creation
 */

const { Client, Pool } = require('pg');

// ═══════════════════════════════════════════════
// CONNECTION POOL
// ═══════════════════════════════════════════════

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'hgv_platform',
  user:     process.env.DB_USER     || 'hgv_user',
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// ═══════════════════════════════════════════════
// QUERY HELPER
// ═══════════════════════════════════════════════

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

async function queryOne(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0] || null;
}

async function queryAll(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

// ═══════════════════════════════════════════════
// SCHEMA — creates all tables if they don't exist
// ═══════════════════════════════════════════════

async function initSchema() {
  console.log('[DB] Initialising schema...');

  await query(`
    CREATE TABLE IF NOT EXISTS organisations (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      slug        VARCHAR(100) NOT NULL UNIQUE,
      plan        VARCHAR(50) NOT NULL DEFAULT 'starter',
      api_key     VARCHAR(64) NOT NULL UNIQUE,
      active      BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id              SERIAL PRIMARY KEY,
      org_id          INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      email           VARCHAR(255) NOT NULL UNIQUE,
      password_hash   VARCHAR(255) NOT NULL,
      full_name       VARCHAR(255) NOT NULL,
      role            VARCHAR(50) NOT NULL DEFAULT 'technician',
      active          BOOLEAN NOT NULL DEFAULT true,
      last_login      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id              SERIAL PRIMARY KEY,
      org_id          INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      registration    VARCHAR(20) NOT NULL,
      make            VARCHAR(100),
      model           VARCHAR(100),
      year            INTEGER,
      fleet_number    VARCHAR(50),
      mileage         INTEGER,
      active          BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(org_id, registration)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id                SERIAL PRIMARY KEY,
      org_id            INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      job_number        VARCHAR(20) NOT NULL UNIQUE,
      vehicle_reg       VARCHAR(20) NOT NULL,
      inspection_type   VARCHAR(50) NOT NULL,
      customer_name     VARCHAR(255) NOT NULL,
      technician_name   VARCHAR(255),
      priority          VARCHAR(20) NOT NULL DEFAULT 'normal',
      status            VARCHAR(50) NOT NULL DEFAULT 'pending',
      wip_status        VARCHAR(50) NOT NULL DEFAULT 'created',
      inspect_sent      BOOLEAN NOT NULL DEFAULT false,
      parts_sent        BOOLEAN NOT NULL DEFAULT false,
      parts_status      VARCHAR(50),
      notes             TEXT,
      scheduled_date    DATE,
      completed_at      TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS inspections (
      id                SERIAL PRIMARY KEY,
      org_id            INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      inspection_id     VARCHAR(20) NOT NULL UNIQUE,
      job_id            INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      vehicle_reg       VARCHAR(20) NOT NULL,
      inspection_type   VARCHAR(50) NOT NULL,
      inspector_name    VARCHAR(255),
      status            VARCHAR(50) NOT NULL DEFAULT 'queued',
      result            VARCHAR(20),
      overall_mileage   INTEGER,
      tyre_data         JSONB,
      check_items       JSONB,
      nil_defect        BOOLEAN NOT NULL DEFAULT false,
      certificate_url   VARCHAR(500),
      notes             TEXT,
      completed_at      TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS defects (
      id                SERIAL PRIMARY KEY,
      org_id            INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      inspection_id     INTEGER REFERENCES inspections(id) ON DELETE CASCADE,
      job_id            INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      vehicle_reg       VARCHAR(20) NOT NULL,
      title             VARCHAR(255) NOT NULL,
      description       TEXT,
      category          VARCHAR(100),
      severity          VARCHAR(20) NOT NULL DEFAULT 'advisory',
      part_name         VARCHAR(255),
      estimated_cost    DECIMAL(10,2),
      part_raised       BOOLEAN NOT NULL DEFAULT false,
      resolved          BOOLEAN NOT NULL DEFAULT false,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS parts (
      id                SERIAL PRIMARY KEY,
      org_id            INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      part_id           VARCHAR(20) NOT NULL UNIQUE,
      job_id            INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      defect_id         INTEGER REFERENCES defects(id) ON DELETE SET NULL,
      vehicle_reg       VARCHAR(20) NOT NULL,
      name              VARCHAR(255) NOT NULL,
      category          VARCHAR(100),
      part_number       VARCHAR(100),
      qty               INTEGER NOT NULL DEFAULT 1,
      unit_cost         DECIMAL(10,2),
      total_cost        DECIMAL(10,2),
      priority          VARCHAR(20) NOT NULL DEFAULT 'normal',
      supplier          VARCHAR(255),
      supplier_ref      VARCHAR(100),
      status            VARCHAR(50) NOT NULL DEFAULT 'pending',
      auto_raised       BOOLEAN NOT NULL DEFAULT false,
      ordered_at        TIMESTAMPTZ,
      received_at       TIMESTAMPTZ,
      notes             TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id            SERIAL PRIMARY KEY,
      org_id        INTEGER REFERENCES organisations(id) ON DELETE SET NULL,
      system        VARCHAR(50) NOT NULL,
      event         VARCHAR(100) NOT NULL,
      detail        TEXT,
      entity_type   VARCHAR(50),
      entity_id     INTEGER,
      user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Indexes for performance
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_org ON jobs(org_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_reg ON jobs(vehicle_reg)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_inspections_org ON inspections(org_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_inspections_reg ON inspections(vehicle_reg)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_parts_org ON parts(org_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_parts_reg ON parts(vehicle_reg)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_parts_status ON parts(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_activity_org ON activity_log(org_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC)`);

  console.log('[DB] Schema ready ✓');
}

// ═══════════════════════════════════════════════
// SEED — creates first organisation + admin user
// ═══════════════════════════════════════════════

const DEMO_JOBS = [
  ['BX19 KLM', 'T50', 'Eddie Stobart', 'T. Harris', 'urgent', 'on_floor', 'on_floor', true, true],
  ['LK23 XPT', 'T50', 'Stobart Fleet', 'J. Patel', 'high', 'on_floor', 'on_floor', true, true],
  ['MV71 RHD', 'T60', 'DHL Logistics', 'M. Clarke', 'normal', 'on_floor', 'on_floor', true, true],
  ['YP20 DRF', 'PMI', 'XPO Logistics', 'D. Thompson', 'normal', 'pending', 'created', false, false],
];

const DEMO_PART_NAMES = {
  'BX19 KLM': 'Brake Caliper Set',
  'LK23 XPT': 'Inspection Parts Kit',
  'MV71 RHD': 'Axle Shaft'
};

function demoInspectionStatus(reg) {
  return reg === 'BX19 KLM' ? 'complete' : 'in_progress';
}

function demoInspectionResult(reg) {
  if (reg === 'BX19 KLM') return 'fail';
  if (reg === 'LK23 XPT') return 'advisory';
  return 'pass';
}

async function insertDemoInspection(orgId, jobId, i, reg, type, tech) {
  await query(`
    INSERT INTO inspections (org_id, inspection_id, job_id, vehicle_reg, inspection_type, inspector_name, status, result)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [orgId, `INS-${200 + i + 1}`, jobId, reg, type, tech, demoInspectionStatus(reg), demoInspectionResult(reg)]);
}

async function insertDemoPart(orgId, jobId, i, reg, priority) {
  await query(`
    INSERT INTO parts (org_id, part_id, job_id, vehicle_reg, name, category, priority, status, unit_cost)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [orgId, `PRT-${300 + i + 1}`, jobId, reg,
      DEMO_PART_NAMES[reg] || 'General Parts', 'General', priority,
      reg === 'MV71 RHD' ? 'ready' : 'pending',
      reg === 'BX19 KLM' ? 285 : 120]);
}

async function seedDemoJobs(orgId) {
  for (let i = 0; i < DEMO_JOBS.length; i++) {
    const [reg, type, customer, tech, priority, status, wip, iSent, pSent] = DEMO_JOBS[i];
    const jobNum = `JOB-${100 + i + 1}`;
    const jobResult = await queryOne(`
      INSERT INTO jobs (org_id, job_number, vehicle_reg, inspection_type, customer_name, technician_name, priority, status, wip_status, inspect_sent, parts_sent)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id
    `, [orgId, jobNum, reg, type, customer, tech, priority, status, wip, iSent, pSent]);

    if (iSent) await insertDemoInspection(orgId, jobResult.id, i, reg, type, tech);
    if (pSent) await insertDemoPart(orgId, jobResult.id, i, reg, priority);
  }
}

async function seedInitialData() {
  const existing = await queryOne(`SELECT id FROM organisations WHERE slug = 'midlands-transport'`);
  if (existing) {
    console.log('[DB] Seed data already exists, skipping');
    return;
  }

  const { v4: uuidv4 } = require('uuid');
  const bcrypt = require('bcryptjs');

  const apiKey = uuidv4().replace(/-/g, '');
  const orgResult = await queryOne(`
    INSERT INTO organisations (name, slug, plan, api_key)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, ['Midlands Transport', 'midlands-transport', 'full_platform', apiKey]);

  const orgId = orgResult.id;
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'ChangeMe123!', 12);

  await query(`
    INSERT INTO users (org_id, email, password_hash, full_name, role)
    VALUES ($1, $2, $3, $4, $5)
  `, [orgId, process.env.ADMIN_EMAIL || 'admin@hgvdesk.co.uk', passwordHash, 'Admin User', 'admin']);

  await seedDemoJobs(orgId);

  await query(`
    INSERT INTO activity_log (org_id, system, event, detail)
    VALUES ($1,'SYSTEM','SEED','Demo data loaded — platform ready')
  `, [orgId]);

  console.log(`[DB] Seed complete ✓`);
  console.log(`[DB] API Key: ${apiKey}`);
  console.log(`[DB] Admin: ${process.env.ADMIN_EMAIL || 'admin@hgvdesk.co.uk'}`);
}

module.exports = { query, queryOne, queryAll, initSchema, seedInitialData, pool };
