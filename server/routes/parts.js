/**
 * HGV PLATFORM — PARTS ROUTES
 */
const { queryOne, queryAll, query } = require('../db');

async function logActivity(orgId, system, event, detail, entityType = null, entityId = null) {
  await query(
    'INSERT INTO activity_log (org_id, system, event, detail, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [orgId, system, event, detail, entityType, entityId]
  );
}

async function getParts(org, queryParams) {
  const orgId = org.id || org.org_id;
  let sql = 'SELECT * FROM parts WHERE org_id = $1';
  const params = [orgId];
  if (queryParams.status) { params.push(queryParams.status); sql += ` AND status = $${params.length}`; }
  if (queryParams.priority) { params.push(queryParams.priority); sql += ` AND priority = $${params.length}`; }
  if (queryParams.reg) { params.push(queryParams.reg.toUpperCase()); sql += ` AND vehicle_reg = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  const parts = await queryAll(sql, params);
  return { parts, total: parts.length };
}

async function createPart(body, org) {
  const orgId = org.id || org.org_id;
  const { vehicleReg, name, category, priority, unitCost, notes, jobId } = body;
  if (!vehicleReg) throw { status: 400, message: 'vehicleReg is required' };
  if (!name) throw { status: 400, message: 'name is required' };
  const partId = 'PRT-' + Date.now().toString().slice(-6);
  const part = await queryOne(
    `INSERT INTO parts (org_id, part_id, job_id, vehicle_reg, name, category, priority, status, unit_cost, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9) RETURNING *`,
    [orgId, partId, jobId || null, vehicleReg.toUpperCase().trim(),
     name, category || 'General', priority || 'normal', unitCost || null, notes || null]
  );
  await logActivity(orgId, 'PARTS', 'PART_CREATED', name + ' for ' + vehicleReg, 'part', part.id);
  return { part };
}

async function updatePart(body, org, partId) {
  const orgId = org.id || org.org_id;
  const existing = await queryOne('SELECT * FROM parts WHERE id = $1 AND org_id = $2', [partId, orgId]);
  if (!existing) throw { status: 404, message: 'Part not found' };
  const { status, priority, unitCost, notes, name, category } = body;
  const part = await queryOne(
    `UPDATE parts SET
      status = COALESCE($1, status),
      priority = COALESCE($2, priority),
      unit_cost = COALESCE($3, unit_cost),
      notes = COALESCE($4, notes),
      name = COALESCE($5, name),
      category = COALESCE($6, category),
      updated_at = NOW()
    WHERE id = $7 AND org_id = $8 RETURNING *`,
    [status || null, priority || null, unitCost || null, notes || null,
     name || null, category || null, partId, orgId]
  );
  await logActivity(orgId, 'PARTS', 'PART_UPDATED', 'Part #' + partId + ' updated', 'part', part.id);
  return { part };
}

async function deletePart(org, partId) {
  const orgId = org.id || org.org_id;
  const existing = await queryOne('SELECT id FROM parts WHERE id = $1 AND org_id = $2', [partId, orgId]);
  if (!existing) throw { status: 404, message: 'Part not found' };
  await query('DELETE FROM parts WHERE id = $1 AND org_id = $2', [partId, orgId]);
  await logActivity(orgId, 'PARTS', 'PART_DELETED', 'Part #' + partId + ' deleted');
  return { deleted: true };
}

async function bulkDeleteParts(org, ids) {
  const orgId = org.id || org.org_id;
  if (!Array.isArray(ids) || !ids.length) throw { status: 400, message: 'ids array required' };
  const result = await query('DELETE FROM parts WHERE id = ANY($1::int[]) AND org_id = $2', [ids, orgId]);
  await logActivity(orgId, 'PARTS', 'PARTS_BULK_DELETED', `${result.rowCount} parts deleted`);
  return { deleted: result.rowCount };
}

async function receiveInboundJob(body, org) {
  const orgId = org.id || org.org_id;
  const { vehicleReg, workshopJobId, jobId } = body;
  if (!vehicleReg) throw { status: 400, message: 'vehicleReg is required' };
  const ref = workshopJobId || jobId;
  await logActivity(orgId, 'WORKSHOP→PARTS', 'INBOUND_JOB_RECEIVED', vehicleReg + (ref ? ' job #' + ref : ''));
  return { received: true };
}

module.exports = { getParts, createPart, updatePart, deletePart, bulkDeleteParts, receiveInboundJob };
