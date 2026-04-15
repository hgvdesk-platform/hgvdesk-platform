const { queryOne, queryAll, query } = require('../db');

async function getVehicles(org, qs) {
  const orgId = org.id || org.org_id;
  let sql = 'SELECT * FROM vehicles WHERE org_id = $1';
  const params = [orgId];
  if (qs.status) { params.push(qs.status); sql += ` AND status = $${params.length}`; }
  if (qs.reg) { params.push(qs.reg.toUpperCase()); sql += ` AND registration = $${params.length}`; }
  sql += ' ORDER BY registration ASC';
  const vehicles = await queryAll(sql, params);
  return { vehicles };
}

async function getVehicle(org, id) {
  const orgId = org.id || org.org_id;
  const vehicle = await queryOne('SELECT * FROM vehicles WHERE id = $1 AND org_id = $2', [id, orgId]);
  if (!vehicle) throw new AppError(404, 'Vehicle not found');
  const jobs = await queryAll('SELECT id, job_number, inspection_type, status, created_at FROM jobs WHERE vehicle_reg = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 20', [vehicle.registration, orgId]);
  const inspections = await queryAll('SELECT id, inspection_id, inspection_type, result, status, created_at FROM inspections WHERE vehicle_reg = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 20', [vehicle.registration, orgId]);
  return { vehicle, jobs, inspections };
}

async function createVehicle(body, org) {
  const orgId = org.id || org.org_id;
  const { registration, make, model, year, vin, fuelType, grossWeight, customerId, motExpiry, serviceDue, fleetNumber } = body;
  if (!registration) throw new AppError(400, 'registration is required');
  const vehicle = await queryOne(
    `INSERT INTO vehicles (org_id, registration, make, model, year, vin, fuel_type, gross_weight, customer_id, mot_expiry, service_due, fleet_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [orgId, registration.toUpperCase().trim(), make || null, model || null, year || null,
     vin || null, fuelType || null, grossWeight || null, customerId || null,
     motExpiry || null, serviceDue || null, fleetNumber || null]
  );
  return { vehicle };
}

async function updateVehicle(body, org, id) {
  const orgId = org.id || org.org_id;
  const existing = await queryOne('SELECT id FROM vehicles WHERE id = $1 AND org_id = $2', [id, orgId]);
  if (!existing) throw new AppError(404, 'Vehicle not found');
  const { make, model, year, vin, fuelType, grossWeight, customerId, motExpiry, serviceDue, status, fleetNumber, mileage } = body;
  const vehicle = await queryOne(
    `UPDATE vehicles SET make=COALESCE($1,make), model=COALESCE($2,model), year=COALESCE($3,year),
     vin=COALESCE($4,vin), fuel_type=COALESCE($5,fuel_type), gross_weight=COALESCE($6,gross_weight),
     customer_id=COALESCE($7,customer_id), mot_expiry=COALESCE($8,mot_expiry), service_due=COALESCE($9,service_due),
     status=COALESCE($10,status), fleet_number=COALESCE($11,fleet_number), mileage=COALESCE($12,mileage), updated_at=NOW()
     WHERE id = $13 AND org_id = $14 RETURNING *`,
    [make||null, model||null, year||null, vin||null, fuelType||null, grossWeight||null,
     customerId||null, motExpiry||null, serviceDue||null, status||null, fleetNumber||null, mileage||null, id, orgId]
  );
  return { vehicle };
}

async function deleteVehicle(org, id) {
  const orgId = org.id || org.org_id;
  await queryOne('UPDATE vehicles SET active = false, status = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 RETURNING id', ['scrapped', id, orgId]);
  return { deleted: true };
}

async function getMotAlerts(org) {
  const orgId = org.id || org.org_id;
  const expiring = await queryAll(
    `SELECT id, registration, make, model, mot_expiry,
     CASE WHEN mot_expiry < CURRENT_DATE THEN 'expired'
          WHEN mot_expiry < CURRENT_DATE + 7 THEN 'urgent'
          WHEN mot_expiry < CURRENT_DATE + 30 THEN 'warning'
          ELSE 'ok' END as mot_status
     FROM vehicles WHERE org_id = $1 AND active = true AND mot_expiry IS NOT NULL AND mot_expiry < CURRENT_DATE + 30
     ORDER BY mot_expiry ASC`, [orgId]
  );
  return { alerts: expiring };
}

module.exports = { getVehicles, getVehicle, createVehicle, updateVehicle, deleteVehicle, getMotAlerts };
