const { queryOne, queryAll, query } = require('../db');
const bcrypt = require('bcryptjs');

async function listTechnicians(org) {
  const orgId = org.id || org.org_id;
  return { technicians: await queryAll('SELECT id, name, phone, username, active, created_at FROM technicians WHERE org_id = $1 ORDER BY name', [orgId]) };
}

async function createTechnician(body, org) {
  const orgId = org.id || org.org_id;
  const { name, phone } = body;
  if (!name) throw new AppError(400, 'Name is required');
  const username = name.toLowerCase().replace(/\s+/g, '.') + '.' + Date.now().toString().slice(-4);
  const tempPassword = 'Tech' + Math.random().toString(36).slice(-6).toUpperCase();
  const hash = await bcrypt.hash(tempPassword, 10);
  const tech = await queryOne(
    'INSERT INTO technicians (org_id, name, phone, username, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, phone, username, active',
    [orgId, name, phone || null, username, hash]
  );
  return { technician: tech, tempPassword };
}

async function updateTechnician(org, techId, body) {
  const orgId = org.id || org.org_id;
  const { name, phone, active } = body;
  const tech = await queryOne(
    'UPDATE technicians SET name=COALESCE($1,name), phone=COALESCE($2,phone), active=COALESCE($3,active), updated_at=NOW() WHERE id=$4 AND org_id=$5 RETURNING id, name, phone, username, active',
    [name||null, phone||null, active!==undefined?active:null, techId, orgId]
  );
  if (!tech) throw new AppError(404, 'Technician not found');
  return { technician: tech };
}

async function deleteTechnician(org, techId) {
  const orgId = org.id || org.org_id;
  await query('DELETE FROM technicians WHERE id=$1 AND org_id=$2', [techId, orgId]);
  return { deleted: true };
}

async function resetPassword(org, techId) {
  const orgId = org.id || org.org_id;
  const tempPassword = 'Tech' + Math.random().toString(36).slice(-6).toUpperCase();
  const hash = await bcrypt.hash(tempPassword, 10);
  await query('UPDATE technicians SET password_hash=$1, updated_at=NOW() WHERE id=$2 AND org_id=$3', [hash, techId, orgId]);
  return { tempPassword };
}

module.exports = { listTechnicians, createTechnician, updateTechnician, deleteTechnician, resetPassword };
