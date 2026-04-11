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

async function createInspection(body, org) {
  const orgId = org.id || org.org_id;
  const {
    vehicleReg, inspectionType, inspectorName, jobId, notes,
    status, checkItems, brakeTestData, tyreData,
    defects, nilDefect, overallMileage
  } = body;
  if (!vehicleReg) throw { status: 400, message: 'vehicleReg is required' };
  // SERVER-SIDE result calculation — never trust the client
  let result = 'pass';
  if (!nilDefect) {
    const openDefects = (defects || []).filter(function(d) { return !d.resolved; });
    const hasCritical = openDefects.some(function(d) { return d.severity === 'critical'; });
    const hasAdvisory = openDefects.some(function(d) { return d.severity === 'advisory' || d.severity === 'major'; });
    const checks = checkItems || {};
    const failedChecks = Object.values(checks).filter(function(s) { return s === 'fail'; }).length;
    const brakeAxles = (brakeTestData && brakeTestData.axles) ? Object.values(brakeTestData.axles) : [];
    const failedBrakes = brakeAxles.filter(function(b) { return !b.pass; }).length;
    const sbe = brakeTestData ? parseFloat(brakeTestData.sbe) : NaN;
    const pbe = brakeTestData ? parseFloat(brakeTestData.pbe) : NaN;
    const brakeEffFail = (!isNaN(sbe) && sbe < 50) || (!isNaN(pbe) && pbe < 16);
    const tyreVals = tyreData ? Object.values(tyreData) : [];
    const failedTyres = tyreVals.filter(function(t) { return t.condition === 'def'; }).length;
    if (hasCritical || failedChecks > 0 || failedBrakes > 0 || brakeEffFail || failedTyres > 0) {
      result = 'fail';
    } else if (hasAdvisory) {
      result = 'advisory';
    }
  }
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

  // Save defects with all new fields
  if (defects && defects.length) {
    for (const d of defects) {
      await query(
        `INSERT INTO defects
          (org_id, inspection_id, job_id, vehicle_reg, title, description, category,
           severity, part_name, estimated_cost, photo_url, resolved, resolved_by,
           resolved_at, resolution_notes, part_raised)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [orgId, inspection.id, jobId || null,
         vehicleReg.toUpperCase().trim(),
         d.title || d.description || 'Defect',
         d.description || null,
         d.category || 'General',
         d.severity || 'advisory',
         d.partName || d.part_name || null,
         d.estimatedCost || d.estimated_cost || null,
         d.photoUrl || d.photo_url || null,
         d.resolved || false,
         d.resolvedBy || d.resolved_by || null,
         d.resolvedAt || d.resolved_at || null,
         d.resolutionNotes || d.resolution_notes || null,
         false]
      ).catch((e) => { console.error('Defect insert error:', e.message); });
    }
  }

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
      orgName: org.org_name || org.name || 'HGV Manager'
    }).catch(() => {});
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
      orgName: org.org_name || org.name || 'HGV Manager'
    }).catch(() => {});
  }

  await logActivity(orgId, 'INSPECT', 'INSPECTION_UPDATED',
    inspection.vehicle_reg + ' — result: ' + (result || inspection.result), 'inspection', inspection.id);
  return { inspection };
}

async function updateDefect(body, org, defectId) {
  const orgId = org.id || org.org_id;
  const { resolved, resolvedBy, resolvedAt, resolutionNotes, photoUrl } = body;
  const defect = await queryOne(
    `UPDATE defects SET
      resolved = COALESCE($1, resolved),
      resolved_by = COALESCE($2, resolved_by),
      resolved_at = COALESCE($3, resolved_at),
      resolution_notes = COALESCE($4, resolution_notes),
      photo_url = COALESCE($5, photo_url),
      updated_at = NOW()
    WHERE id = $6 AND org_id = $7 RETURNING *`,
    [resolved !== undefined ? resolved : null,
     resolvedBy || null,
     resolvedAt || null,
     resolutionNotes || null,
     photoUrl || null,
     defectId, orgId]
  );
  if (!defect) throw { status: 404, message: 'Defect not found' };

  // Auto-update inspection result when all defects resolved
  if (resolved === true && defect.inspection_id) {
    const openDefects = await queryAll(
      'SELECT id FROM defects WHERE inspection_id = $1 AND org_id = $2 AND resolved = false',
      [defect.inspection_id, orgId]
    );
    if (openDefects.length === 0) {
      await queryOne(
        'UPDATE inspections SET result = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 RETURNING id',
        ['pass', defect.inspection_id, orgId]
      );
    }
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

module.exports = {
  getInspections, createInspection, updateInspection, deleteInspection,
  receiveAssignedJob, raiseDefects, updateDefect, getDefects
};
