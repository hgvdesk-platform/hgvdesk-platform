/**
 * HGV PLATFORM — INSPECT ROUTES
 */
const { queryOne, queryAll, query } = require('../db');
const { sendFailedInspectionAlert } = require('../mailer');

async function logActivity(orgId, system, event, detail, entityType = null, entityId = null) {
  await query(
    'INSERT INTO activity_log (org_id, system, event, detail, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [orgId, system, event, detail, entityType, entityId]
  );
}

async function getInspections(org, queryParams) {
  const orgId = org.id || org.org_id;
  let sql = `SELECT i.*, 
    (SELECT json_agg(d.*) FROM defects d WHERE d.inspection_id = i.id) as defects_data
    FROM inspections i WHERE i.org_id = $1`;
  const params = [orgId];
  if (queryParams.result) { params.push(queryParams.result); sql += ` AND i.result = $${params.length}`; }
  if (queryParams.status) { params.push(queryParams.status); sql += ` AND i.status = $${params.length}`; }
  if (queryParams.reg) { params.push(queryParams.reg.toUpperCase()); sql += ` AND i.vehicle_reg = $${params.length}`; }
  sql += ' ORDER BY i.created_at DESC';
  const inspections = await queryAll(sql, params);
  return { inspections, total: inspections.length };
}

function hasFailingDefect(defects) {
  const open = (defects || []).filter(d => !d.resolved);
  return open.some(d => d.severity === 'critical');
}

function hasAdvisoryDefect(defects) {
  const open = (defects || []).filter(d => !d.resolved);
  return open.some(d => d.severity === 'advisory' || d.severity === 'major');
}

function countFailedChecks(checkItems) {
  return Object.values(checkItems || {}).filter(s => s === 'fail').length;
}

function countAdvisoryChecks(checkItems) {
  return Object.values(checkItems || {}).filter(s => s === 'adv').length;
}

function brakesFail(brakeTestData) {
  if (!brakeTestData) return false;
  const axles = brakeTestData.axles ? Object.values(brakeTestData.axles) : [];
  if (axles.some(b => !b.pass)) return true;
  const sbe = parseFloat(brakeTestData.sbe);
  const sbe2 = parseFloat(brakeTestData.sbe2);
  const pbe = parseFloat(brakeTestData.pbe);
  return (!isNaN(sbe) && sbe < 50) || (!isNaN(sbe2) && sbe2 < 50) || (!isNaN(pbe) && pbe < 16);
}

function countFailedTyres(tyreData) {
  return Object.values(tyreData || {}).filter(t => t.condition === 'def').length;
}

function calculateInspectionResult({ nilDefect, defects, checkItems, brakeTestData, tyreData }) {
  if (nilDefect) return 'pass';
  const failing = hasFailingDefect(defects)
    || countFailedChecks(checkItems) > 0
    || brakesFail(brakeTestData)
    || countFailedTyres(tyreData) > 0;
  if (failing) return 'fail';
  if (hasAdvisoryDefect(defects) || countAdvisoryChecks(checkItems) > 0) return 'advisory';
  return 'pass';
}

async function insertInspectionDefects(orgId, inspectionId, jobId, vehicleReg, defects) {
  if (!defects || !defects.length) return;
  for (const d of defects) {
    await query(
      `INSERT INTO defects
        (org_id, inspection_id, job_id, vehicle_reg, title, description, category,
         severity, part_name, estimated_cost, photo_url, repair_photo_url, resolved, resolved_by,
         resolved_at, resolution_notes, part_raised)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [orgId, inspectionId, jobId || null,
       vehicleReg.toUpperCase().trim(),
       d.title || d.description || 'Defect',
       d.description || null,
       d.category || 'General',
       d.severity || 'advisory',
       d.partName || d.part_name || null,
       d.estimatedCost || d.estimated_cost || null,
       d.photoUrl || d.photo_url || null,
       d.repairPhotoUrl || d.repair_photo_url || null,
       d.resolved || false,
       d.resolvedBy || d.resolved_by || null,
       d.resolvedAt || d.resolved_at || null,
       d.resolutionNotes || d.resolution_notes || null,
       false]
    ).catch((e) => { console.error('Defect insert error:', e.message); });
  }
}

async function createInspection(body, org) {
  const orgId = org.id || org.org_id;
  const {
    vehicleReg, inspectionType, inspectorName, jobId, notes,
    status, checkItems, brakeTestData, tyreData,
    defects, nilDefect, overallMileage
  } = body;
  if (!vehicleReg) throw { status: 400, message: 'vehicleReg is required' };

  const result = calculateInspectionResult({ nilDefect, defects, checkItems, brakeTestData, tyreData });
  const inspId = 'INS-' + Date.now().toString().slice(-6);
  const isComplete = status === 'complete';
  const finalStatus = isComplete ? 'complete' : (status || 'in_progress');
  const completedAt = isComplete ? new Date().toISOString() : null;

  const inspection = await queryOne(
    `INSERT INTO inspections
      (org_id, inspection_id, job_id, vehicle_reg, inspection_type, inspector_name,
       status, result, check_items, tyre_data, brake_test_data, nil_defect, notes,
       overall_mileage, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15)
     RETURNING *`,
    [orgId, inspId, jobId || null,
     vehicleReg.toUpperCase().trim(),
     inspectionType || 'T50',
     inspectorName || null,
     finalStatus,
     result || null,
     checkItems ? JSON.stringify(checkItems) : null,
     tyreData ? JSON.stringify(tyreData) : null,
     brakeTestData ? JSON.stringify(brakeTestData) : null,
     nilDefect || false,
     notes || null,
     overallMileage || null,
     completedAt]
  );

  await insertInspectionDefects(orgId, inspection.id, jobId, vehicleReg, defects);

  await logActivity(orgId, 'INSPECT',
    isComplete ? 'INSPECTION_COMPLETED' : 'INSPECTION_CREATED',
    vehicleReg + ' — ' + inspId, 'inspection', inspection.id);

  if (isComplete && result === 'fail') {
    sendFailedInspectionAlert({
      vehicleReg: inspection.vehicle_reg,
      inspectorName: inspection.inspector_name,
      inspectionId: inspection.inspection_id,
      result: inspection.result,
      notes: inspection.notes,
      orgName: org.org_name || org.name || 'HGVDesk'
    }).catch(() => {});
  }

  // Auto-calculate costs and push to linked job when complete
  if (isComplete) {
    try { await calculateInspectionCosts(org, inspection.id); } catch (e) { console.error('[INSPECT] cost calc error:', e.message); }
  }

  return { inspection };
}

async function updateInspection(body, org, inspectionId) {
  const orgId = org.id || org.org_id;
  const existing = await queryOne('SELECT * FROM inspections WHERE id = $1 AND org_id = $2', [inspectionId, orgId]);
  if (!existing) throw { status: 404, message: 'Inspection not found' };

  const { result, status, checkItems, tyreData, brakeTestData, nilDefect, notes, inspectorName, overallMileage } = body;
  const isComplete = status === 'complete';

  const inspection = await queryOne(
    `UPDATE inspections SET
      result = COALESCE($1, result),
      status = COALESCE($2, status),
      check_items = COALESCE($3::jsonb, check_items),
      tyre_data = COALESCE($4::jsonb, tyre_data),
      brake_test_data = COALESCE($5::jsonb, brake_test_data),
      nil_defect = COALESCE($6, nil_defect),
      notes = COALESCE($7, notes),
      inspector_name = COALESCE($8, inspector_name),
      overall_mileage = COALESCE($9, overall_mileage),
      completed_at = CASE WHEN $2 = 'complete' AND completed_at IS NULL THEN NOW() ELSE completed_at END,
      updated_at = NOW()
    WHERE id = $10 AND org_id = $11 RETURNING *`,
    [result || null, status || null,
     checkItems ? JSON.stringify(checkItems) : null,
     tyreData ? JSON.stringify(tyreData) : null,
     brakeTestData ? JSON.stringify(brakeTestData) : null,
     nilDefect !== undefined ? nilDefect : null,
     notes || null,
     inspectorName || null,
     overallMileage || null,
     inspectionId, orgId]
  );

  if (result === 'fail') {
    sendFailedInspectionAlert({
      vehicleReg: inspection.vehicle_reg,
      inspectorName: inspection.inspector_name,
      inspectionId: inspection.inspection_id,
      result: inspection.result,
      notes: inspection.notes,
      orgName: org.org_name || org.name || 'HGVDesk'
    }).catch(() => {});
  }

  await logActivity(orgId, 'INSPECT', 'INSPECTION_UPDATED',
    inspection.vehicle_reg + ' — result: ' + (result || inspection.result), 'inspection', inspection.id);
  return { inspection };
}

async function updateDefect(body, org, defectId) {
  const orgId = org.id || org.org_id;
  const { resolved, resolvedBy, resolvedAt, resolutionNotes, photoUrl, repairPhotoUrl } = body;
  const defect = await queryOne(
    `UPDATE defects SET
      resolved = COALESCE($1, resolved),
      resolved_by = COALESCE($2, resolved_by),
      resolved_at = COALESCE($3, resolved_at),
      resolution_notes = COALESCE($4, resolution_notes),
      photo_url = COALESCE($5, photo_url),
      repair_photo_url = COALESCE($6, repair_photo_url),
      updated_at = NOW()
    WHERE id = $7 AND org_id = $8 RETURNING *`,
    [resolved !== undefined ? resolved : null,
     resolvedBy || null,
     resolvedAt || null,
     resolutionNotes || null,
     photoUrl || null,
     repairPhotoUrl || null,
     defectId, orgId]
  );
  if (!defect) throw { status: 404, message: 'Defect not found' };

  // Full recalculation using all inspection inputs (defects + check items + brakes + tyres)
  if (resolved !== undefined && defect.inspection_id) {
    const insp = await queryOne(
      'SELECT check_items, brake_test_data, tyre_data, nil_defect FROM inspections WHERE id = $1 AND org_id = $2',
      [defect.inspection_id, orgId]
    );
    const openDefects = await queryAll(
      'SELECT severity FROM defects WHERE inspection_id = $1 AND org_id = $2 AND resolved = false',
      [defect.inspection_id, orgId]
    );
    const checkItems = typeof insp.check_items === 'string' ? JSON.parse(insp.check_items) : (insp.check_items || {});
    const brakeTestData = typeof insp.brake_test_data === 'string' ? JSON.parse(insp.brake_test_data) : (insp.brake_test_data || null);
    const tyreData = typeof insp.tyre_data === 'string' ? JSON.parse(insp.tyre_data) : (insp.tyre_data || {});
    const newResult = calculateInspectionResult({
      nilDefect: insp.nil_defect,
      defects: openDefects.map(d => ({ severity: d.severity, resolved: false })),
      checkItems, brakeTestData, tyreData
    });
    await queryOne(
      'UPDATE inspections SET result = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 RETURNING id',
      [newResult, defect.inspection_id, orgId]
    );
  }

  return { defect };
}

async function getDefects(org, queryParams) {
  const orgId = org.id || org.org_id;
  let sql = 'SELECT * FROM defects WHERE org_id = $1';
  const params = [orgId];
  if (queryParams.inspectionId) { params.push(queryParams.inspectionId); sql += ` AND inspection_id = $${params.length}`; }
  if (queryParams.jobId) { params.push(queryParams.jobId); sql += ` AND job_id = $${params.length}`; }
  if (queryParams.reg) { params.push(queryParams.reg.toUpperCase()); sql += ` AND vehicle_reg = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  const defects = await queryAll(sql, params);
  return { defects };
}

async function deleteInspection(org, inspectionId) {
  const orgId = org.id || org.org_id;
  const existing = await queryOne('SELECT id FROM inspections WHERE id = $1 AND org_id = $2', [inspectionId, orgId]);
  if (!existing) throw { status: 404, message: 'Inspection not found' };
  await query('DELETE FROM inspections WHERE id = $1 AND org_id = $2', [inspectionId, orgId]);
  await logActivity(orgId, 'INSPECT', 'INSPECTION_DELETED', 'Inspection #' + inspectionId + ' deleted');
  return { deleted: true };
}

async function bulkDeleteInspections(org, ids) {
  const orgId = org.id || org.org_id;
  if (!Array.isArray(ids) || !ids.length) throw { status: 400, message: 'ids array required' };
  const result = await query('DELETE FROM inspections WHERE id = ANY($1::int[]) AND org_id = $2', [ids, orgId]);
  await logActivity(orgId, 'INSPECT', 'INSPECTIONS_BULK_DELETED', `${result.rowCount} inspections deleted`);
  return { deleted: result.rowCount };
}

async function receiveAssignedJob(body, org) {
  const orgId = org.id || org.org_id;
  const { vehicleReg, inspectionType, technicianName, workshopJobId, jobId } = body;
  if (!vehicleReg) throw { status: 400, message: 'vehicleReg is required' };
  const jobRef = workshopJobId || jobId;
  if (jobRef) {
    const exists = await queryOne('SELECT id, inspection_id FROM inspections WHERE job_id = $1 AND org_id = $2', [jobRef, orgId]);
    if (exists) {
      await logActivity(orgId, 'WORKSHOP→INSPECT', 'DUPLICATE_IGNORED', vehicleReg + ' already in Inspect');
      return { inspection: exists, created: false };
    }
  }
  const inspId = 'INS-' + Date.now().toString().slice(-6);
  const inspection = await queryOne(
    `INSERT INTO inspections (org_id, inspection_id, job_id, vehicle_reg, inspection_type, inspector_name, status)
     VALUES ($1,$2,$3,$4,$5,$6,'queued') RETURNING *`,
    [orgId, inspId, jobRef || null, vehicleReg.toUpperCase().trim(), inspectionType || 'T50', technicianName || null]
  );
  await logActivity(orgId, 'WORKSHOP→INSPECT', 'JOB_RECEIVED', vehicleReg + ' received → ' + inspId, 'inspection', inspection.id);
  return { inspection, created: true };
}

async function raiseDefects(body, org) {
  const orgId = org.id || org.org_id;
  const { vehicleReg, workshopJobId, inspectionId, defects = [] } = body;
  if (!vehicleReg) throw { status: 400, message: 'vehicleReg is required' };
  if (!Array.isArray(defects) || defects.length === 0) throw { status: 400, message: 'defects array is required' };
  const reg = vehicleReg.toUpperCase().trim();
  const raised = [];
  for (const defect of defects) {
    const defectRecord = await queryOne(
      `INSERT INTO defects
        (org_id, inspection_id, job_id, vehicle_reg, title, description, category,
         severity, part_name, estimated_cost, photo_url, part_raised)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) RETURNING *`,
      [orgId, inspectionId || null, workshopJobId || null, reg,
       defect.title || 'Unknown Defect',
       defect.description || null,
       defect.category || 'General',
       defect.severity || 'advisory',
       defect.partName || null,
       defect.estimatedCost || null,
       defect.photoUrl || null]
    );
    const partId = 'PRT-' + Date.now().toString().slice(-6) + '-' + raised.length;
    const part = await queryOne(
      `INSERT INTO parts (org_id, part_id, job_id, defect_id, vehicle_reg, name, category, priority, status, unit_cost, auto_raised)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,true) RETURNING *`,
      [orgId, partId, workshopJobId || null, defectRecord.id, reg,
       defect.partName || (defect.title + ' — Replacement Part'),
       defect.category || 'General',
       defect.severity === 'critical' ? 'urgent' : 'high',
       defect.estimatedCost || null]
    );
    raised.push(part);
    await logActivity(orgId, 'INSPECT→PARTS', 'DEFECT_PART_RAISED',
      'Auto-raised: ' + part.name + ' for ' + reg, 'part', part.id);
  }
  await logActivity(orgId, 'INSPECT', 'DEFECTS_RAISED',
    raised.length + ' parts raised for ' + reg, 'inspection', inspectionId);
  return { raised: raised.length, parts: raised };
}

// ── Inspection Parts (parts used during inspection) ──

async function getInspectionParts(org, inspectionId) {
  const orgId = org.id || org.org_id;
  return queryAll('SELECT * FROM inspection_parts WHERE org_id = $1 AND inspection_id = $2 ORDER BY id', [orgId, inspectionId]);
}

async function addInspectionPart(body, org) {
  const orgId = org.id || org.org_id;
  const { inspectionId, partId, partName, quantity, unitCost } = body;
  if (!inspectionId || !partName) throw { status: 400, message: 'inspectionId and partName required' };
  const qty = parseInt(quantity || 1);
  const cost = parseFloat(unitCost || 0);
  const lineTotal = Math.round(qty * cost * 100) / 100;

  const row = await queryOne(
    `INSERT INTO inspection_parts (org_id, inspection_id, part_id, part_name, quantity, unit_cost, line_total)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [orgId, inspectionId, partId || null, partName, qty, cost, lineTotal]
  );

  // Reduce stock if part_id set
  if (partId) {
    await query('UPDATE parts SET stock_quantity = GREATEST(stock_quantity - $1, 0) WHERE id = $2 AND org_id = $3', [qty, partId, orgId]);
  }

  return row;
}

async function removeInspectionPart(org, id) {
  const orgId = org.id || org.org_id;
  await query('DELETE FROM inspection_parts WHERE id = $1 AND org_id = $2', [id, orgId]);
  return { deleted: true };
}

// Calculate costs and push to linked job
async function calculateInspectionCosts(org, inspectionId) {
  const orgId = org.id || org.org_id;
  const insp = await queryOne('SELECT * FROM inspections WHERE id = $1 AND org_id = $2', [inspectionId, orgId]);
  if (!insp) throw { status: 404, message: 'Inspection not found' };

  const usedParts = await queryAll('SELECT * FROM inspection_parts WHERE inspection_id = $1 AND org_id = $2', [inspectionId, orgId]);
  const partsCost = usedParts.reduce((sum, p) => sum + parseFloat(p.line_total || 0), 0);

  // Labour: time from created_at to completed_at, or fallback to 1 hour
  let labourHours = 1;
  if (insp.completed_at && insp.created_at) {
    labourHours = Math.max(0.25, Math.round((new Date(insp.completed_at) - new Date(insp.created_at)) / 3600000 * 4) / 4);
  }
  const labourRate = 65;
  const labourCost = Math.round(labourHours * labourRate * 100) / 100;
  const totalCost = Math.round((partsCost + labourCost) * 100) / 100;

  // Update linked job if exists
  if (insp.job_id) {
    await query(
      'UPDATE jobs SET parts_cost = $1, labour_cost = $2, total_cost = $3, sold_hours = $4, updated_at = NOW() WHERE id = $5 AND org_id = $6',
      [partsCost, labourCost, totalCost, labourHours, insp.job_id, orgId]
    );
  }

  return { inspectionId, partsCost, labourHours, labourRate, labourCost, totalCost, partsUsed: usedParts.length, jobId: insp.job_id };
}

module.exports = {
  getInspections, createInspection, updateInspection, deleteInspection, bulkDeleteInspections,
  receiveAssignedJob, raiseDefects, updateDefect, getDefects,
  getInspectionParts, addInspectionPart, removeInspectionPart, calculateInspectionCosts
};
