/**
 * HGV PLATFORM — WORKSHOP ROUTES
 */
const { queryOne, queryAll, query } = require('../db');

async function logActivity(orgId, system, event, detail, entityType = null, entityId = null) {
  await query(
    'INSERT INTO activity_log (org_id, system, event, detail, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [orgId, system, event, detail, entityType, entityId]
  );
}

async function getJobs(req, org, queryParams) {
  const orgId = org.id || org.org_id;
  let sql = 'SELECT * FROM jobs WHERE org_id = $1';
  const params = [orgId];
  if (queryParams.status) { params.push(queryParams.status); sql += ` AND status = $${params.length}`; }
  if (queryParams.reg) { params.push(queryParams.reg.toUpperCase()); sql += ` AND vehicle_reg = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  const jobs = await queryAll(sql, params);
  return { jobs, total: jobs.length };
}

async function getJob(req, org, jobId) {
  const orgId = org.id || org.org_id;
  const job = await queryOne('SELECT * FROM jobs WHERE id = $1 AND org_id = $2', [jobId, orgId]);
  if (!job) throw new AppError(404, 'Job not found');
  return { job };
}

async function createJob(body, org) {
  const orgId = org.id || org.org_id;
  const { vehicleReg, inspectionType, technicianName, customerName, customerId, priority, notes, scheduledDate, trailerId } = body;
  if (!vehicleReg) throw new AppError(400, 'vehicleReg is required');
  if (!customerName) throw new AppError(400, 'customerName is required');

  const reg = vehicleReg.toUpperCase().trim();
  // Skip vehicle limit enforcement for T60 trailers using generic IDs
  if (inspectionType !== 'T60' || (reg !== 'TRAILER' && !reg.startsWith('TRL'))) {
    const { enforceVehicleLimit } = require('./stripe');
    await enforceVehicleLimit(orgId, org.plan, reg);
  }

  const jobNumber = 'WS-' + Date.now().toString().slice(-6);
  const job = await queryOne(
    `INSERT INTO jobs (org_id, job_number, vehicle_reg, inspection_type, customer_name, technician_name, priority, status, notes, scheduled_date, customer_id, trailer_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10,$11) RETURNING *`,
    [orgId, jobNumber, reg,
     inspectionType || 'T50', customerName,
     technicianName || null, priority || 'normal',
     notes || null, scheduledDate || null, customerId || null,
     trailerId || null]
  );
  await logActivity(orgId, 'WORKSHOP', 'JOB_CREATED', reg + ' — ' + jobNumber, 'job', job.id);
  return { job };
}

async function updateJob(body, org, jobId) {
  const orgId = org.id || org.org_id;
  const existing = await queryOne('SELECT * FROM jobs WHERE id = $1 AND org_id = $2', [jobId, orgId]);
  if (!existing) throw new AppError(404, 'Job not found');
  const { status, technicianName, priority, notes, inspectionType } = body;
  const job = await queryOne(
    `UPDATE jobs SET
      status = COALESCE($1, status),
      technician_name = COALESCE($2, technician_name),
      priority = COALESCE($3, priority),
      notes = COALESCE($4, notes),
      inspection_type = COALESCE($5, inspection_type),
      completed_at = CASE WHEN $1 = 'complete' THEN NOW() ELSE completed_at END,
      updated_at = NOW()
    WHERE id = $6 AND org_id = $7 RETURNING *`,
    [status || null, technicianName || null, priority || null, notes || null,
     inspectionType || null, jobId, orgId]
  );
  await logActivity(orgId, 'WORKSHOP', 'JOB_UPDATED', `Job #${jobId} updated`, 'job', job.id);
  return { job };
}

async function deleteJob(org, jobId) {
  const orgId = org.id || org.org_id;
  const existing = await queryOne('SELECT id FROM jobs WHERE id = $1 AND org_id = $2', [jobId, orgId]);
  if (!existing) throw new AppError(404, 'Job not found');
  await query('DELETE FROM jobs WHERE id = $1 AND org_id = $2', [jobId, orgId]);
  await logActivity(orgId, 'WORKSHOP', 'JOB_DELETED', `Job #${jobId} deleted`);
  return { deleted: true };
}

async function bulkDeleteJobs(org, ids) {
  const orgId = org.id || org.org_id;
  if (!Array.isArray(ids) || !ids.length) throw new AppError(400, 'ids array required');
  const result = await query('DELETE FROM jobs WHERE id = ANY($1::int[]) AND org_id = $2', [ids, orgId]);
  await logActivity(orgId, 'WORKSHOP', 'JOBS_BULK_DELETED', `${result.rowCount} jobs deleted`);
  return { deleted: result.rowCount };
}

async function sendToFloor(body, org, jobId) {
  const orgId = org.id || org.org_id;
  const job = await queryOne('SELECT * FROM jobs WHERE id = $1 AND org_id = $2', [jobId, orgId]);
  if (!job) throw new AppError(404, 'Job not found');
  const targets = body.targets || ['inspect'];

  const results = {};

  if (targets.includes('inspect')) {
    try {
      const exists = await queryOne(
        'SELECT id FROM inspections WHERE job_id = $1 AND org_id = $2', [jobId, orgId]
      );
      if (!exists) {
        const inspId = 'INS-' + Date.now().toString().slice(-6);
        await queryOne(
          `INSERT INTO inspections (org_id, inspection_id, job_id, vehicle_reg, inspection_type, inspector_name, customer_name, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'queued') RETURNING *`,
          [orgId, inspId, jobId, job.vehicle_reg, job.inspection_type || body.inspectionType || 'T50', job.technician_name, job.customer_name || null]
        );
        results.inspect = 'queued';
      } else {
        results.inspect = 'already_exists';
      }
    } catch (e) {
      results.inspect = 'error: ' + e.message;
    }
  }

  if (targets.includes('parts')) {
    results.parts = 'notified';
  }

  const inspSent = targets.includes('inspect');
  const partsSent = targets.includes('parts');
  await queryOne(
    `UPDATE jobs SET status = 'in_progress',
      inspect_sent = CASE WHEN $1 THEN true ELSE inspect_sent END,
      parts_sent = CASE WHEN $2 THEN true ELSE parts_sent END,
      updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [inspSent, partsSent, jobId]
  );
  await logActivity(orgId, 'WORKSHOP', 'JOB_SENT_TO_FLOOR', `Job #${jobId} sent to: ${targets.join(', ')}`, 'job', jobId);
  return { sent: true, targets: results };
}

async function receivePartsUpdate(body, org) {
  const orgId = org.id || org.org_id;
  const { workshopJobId, jobId, status, notes } = body;
  const ref = workshopJobId || jobId;
  if (!ref) throw new AppError(400, 'workshopJobId required');
  const job = await queryOne('SELECT * FROM jobs WHERE id = $1 AND org_id = $2', [ref, orgId]);
  if (!job) throw new AppError(404, 'Job not found');
  await logActivity(orgId, 'PARTS→WORKSHOP', 'PARTS_UPDATE_RECEIVED', `Job #${ref}: ${notes || status || 'update'}`, 'job', ref);
  return { received: true };
}


async function getJobLibrary(caller) {
  const { queryAll } = require('../db');
  const orgId = caller.org_id || caller.id;
  const jobs = await queryAll(
    'SELECT * FROM job_library WHERE org_id = $1 ORDER BY category, name ASC',
    [orgId]
  );
  return { jobs };
}

async function getJobLines(caller, jobId) {
  const { queryAll } = require('../db');
  const orgId = caller.org_id || caller.id;
  const lines = await queryAll(
    'SELECT * FROM job_lines WHERE job_id = $1 AND org_id = $2 ORDER BY created_at ASC',
    [jobId, orgId]
  );
  const totalSoldHours = lines.reduce((sum, l) => sum + Number.parseFloat(l.sold_hours) * Number.parseFloat(l.quantity), 0);
  return { lines, totalSoldHours };
}

async function saveJobLines(body, caller, jobId) {
  const { query, queryAll } = require('../db');
  const orgId = caller.org_id || caller.id;
  const { lines } = body;
  // Delete existing lines for this job
  await query('DELETE FROM job_lines WHERE job_id = $1 AND org_id = $2', [jobId, orgId]);
  // Insert new lines
  for (const line of (lines || [])) {
    await query(
      'INSERT INTO job_lines (org_id, job_id, job_library_id, code, name, sold_hours, quantity, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [orgId, jobId, line.job_library_id || null, line.code || '', line.name, line.sold_hours, line.quantity || 1, line.notes || null]
    );
  }
  // Update sold_hours total on the job
  const totalSoldHours = (lines || []).reduce((sum, l) => sum + Number.parseFloat(l.sold_hours) * Number.parseFloat(l.quantity || 1), 0);
  await query('UPDATE jobs SET sold_hours = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3', [totalSoldHours, jobId, orgId]);
  return { saved: true, totalSoldHours };
}

module.exports = { getJobs, getJob, createJob, updateJob, deleteJob, bulkDeleteJobs, sendToFloor, receivePartsUpdate ,
  getJobLibrary,
  getJobLines,
  saveJobLines
};