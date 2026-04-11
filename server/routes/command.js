/**
 * HGV PLATFORM — COMMAND ROUTES
 * GET /api/command/overview    — master cross-system view
 * GET /api/command/alerts      — active alerts
 * GET /api/activity            — activity log
 * POST /api/auth/login         — authentication
 */

const { queryOne, queryAll, query } = require('../db');
const { login } = require('../auth');

// ═══════════════════════════════════════════════
// GET /api/command/overview
// ═══════════════════════════════════════════════

async function getOverview(org) {
  const orgId = org.id || org.org_id;

  const [
    workshopStats, inspectStats, partsStats,
    urgentJobs, failedInspections, urgentParts, recentActivity
  ] = await Promise.all([
    // Workshop stats
    queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE status != 'done') as active,
        COUNT(*) FILTER (WHERE wip_status = 'on_floor') as on_floor,
        COUNT(*) FILTER (WHERE priority = 'urgent') as urgent,
        COUNT(*) as total
      FROM jobs WHERE org_id = $1
    `, [orgId]),

    // Inspect stats
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE result = 'pass') as passed,
        COUNT(*) FILTER (WHERE result = 'fail') as failed,
        COUNT(*) FILTER (WHERE result = 'advisory') as advisory,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'queued') as queued
      FROM inspections WHERE org_id = $1
    `, [orgId]),

    // Parts stats
    queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'ordered') as ordered,
        COUNT(*) FILTER (WHERE status = 'ready') as ready,
        COUNT(*) as total,
        SUM(total_cost) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as spend_mtd
      FROM parts WHERE org_id = $1
    `, [orgId]),

    // Urgent jobs
    queryAll(`SELECT id, job_number, vehicle_reg, customer_name, status, priority FROM jobs WHERE org_id = $1 AND priority = 'urgent' AND status != 'done' ORDER BY created_at DESC LIMIT 5`, [orgId]),

    // Failed inspections
    queryAll(`SELECT id, inspection_id, vehicle_reg, result, created_at FROM inspections WHERE org_id = $1 AND result = 'fail' ORDER BY created_at DESC LIMIT 5`, [orgId]),

    // Urgent parts
    queryAll(`SELECT id, part_id, vehicle_reg, name, priority, status FROM parts WHERE org_id = $1 AND priority = 'urgent' AND status = 'pending' ORDER BY created_at DESC LIMIT 5`, [orgId]),

    // Recent activity
    queryAll(`SELECT * FROM activity_log WHERE org_id = $1 ORDER BY created_at DESC LIMIT 25`, [orgId])
  ]);

  const alerts = [
    ...failedInspections.map(i => ({
      type: 'inspection_fail', severity: 'critical',
      title: `Inspection FAIL — ${i.vehicle_reg}`,
      detail: `${i.inspection_id} — immediate attention required`,
      entityId: i.id
    })),
    ...urgentParts.map(p => ({
      type: 'urgent_parts', severity: 'high',
      title: `Urgent Parts Needed — ${p.vehicle_reg}`,
      detail: p.name,
      entityId: p.id
    })),
    ...urgentJobs.filter(j => !failedInspections.find(i => i.vehicle_reg === j.vehicle_reg)).map(j => ({
      type: 'urgent_job', severity: 'high',
      title: `Urgent Job — ${j.vehicle_reg}`,
      detail: `${j.job_number} — ${j.customer_name}`,
      entityId: j.id
    }))
  ];

  return {
    workshop: {
      active: parseInt(workshopStats.active),
      onFloor: parseInt(workshopStats.on_floor),
      urgent: parseInt(workshopStats.urgent),
      total: parseInt(workshopStats.total)
    },
    inspect: {
      total: parseInt(inspectStats.total),
      passed: parseInt(inspectStats.passed),
      failed: parseInt(inspectStats.failed),
      advisory: parseInt(inspectStats.advisory),
      inProgress: parseInt(inspectStats.in_progress),
      queued: parseInt(inspectStats.queued)
    },
    parts: {
      pending: parseInt(partsStats.pending),
      ordered: parseInt(partsStats.ordered),
      ready: parseInt(partsStats.ready),
      total: parseInt(partsStats.total),
      spendMtd: parseFloat(partsStats.spend_mtd || 0).toFixed(2)
    },
    alerts,
    alertCount: alerts.length,
    recentActivity
  };
}

// ═══════════════════════════════════════════════
// GET /api/activity
// ═══════════════════════════════════════════════

async function getActivity(org, queryParams) {
  const orgId = org.id || org.org_id;
  const limit = parseInt(queryParams.limit || '50');
  const offset = parseInt(queryParams.offset || '0');

  const activities = await queryAll(
    `SELECT * FROM activity_log WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [orgId, limit, offset]
  );
  const countResult = await queryOne(`SELECT COUNT(*) as count FROM activity_log WHERE org_id = $1`, [orgId]);

  return { activity: activities, total: parseInt(countResult.count), limit, offset };
}

// ═══════════════════════════════════════════════
// POST /api/auth/login
// ═══════════════════════════════════════════════

async function handleLogin(body) {
  const { email, password } = body;
  return await login(email, password);
}

module.exports = { getOverview, getActivity, handleLogin };
