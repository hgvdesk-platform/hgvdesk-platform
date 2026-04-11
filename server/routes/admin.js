/**
 * HGV PLATFORM — ADMIN ROUTES
 */
const { queryAll, queryOne, query } = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function requireAdmin(user) {
  if (user.role !== 'admin') throw { status: 403, message: 'Admin access required' };
}

async function getOrganisations(user) {
  await requireAdmin(user);
  const orgs = await queryAll('SELECT * FROM organisations ORDER BY created_at DESC', []);
  return { organisations: orgs };
}

async function createOrganisation(body, user) {
  await requireAdmin(user);
  const { name, plan } = body;
  if (!name) throw { status: 400, message: 'name is required' };
  const apiKey = crypto.randomBytes(16).toString('hex');
  const org = await queryOne(
    'INSERT INTO organisations (name, plan, api_key, active) VALUES ($1,$2,$3,true) RETURNING *',
    [name, plan || 'starter', apiKey]
  );
  return { organisation: org };
}

async function updateOrganisation(body, user, orgId) {
  await requireAdmin(user);
  const { name, plan, active } = body;
  const org = await queryOne(
    'UPDATE organisations SET name=COALESCE($1,name), plan=COALESCE($2,plan), active=COALESCE($3,active), updated_at=NOW() WHERE id=$4 RETURNING *',
    [name || null, plan || null, active !== undefined ? active : null, orgId]
  );
  if (!org) throw { status: 404, message: 'Organisation not found' };
  return { organisation: org };
}

async function getUsers(user) {
  await requireAdmin(user);
  const users = await queryAll('SELECT id, org_id, email, full_name, role, active, created_at, last_login FROM users ORDER BY created_at DESC', []);
  return { users };
}

async function createUser(body, user) {
  await requireAdmin(user);
  const { email, password, fullName, orgId, role } = body;
  if (!email || !password) throw { status: 400, message: 'email and password required' };
  const hash = await bcrypt.hash(password, 10);
  const newUser = await queryOne(
    'INSERT INTO users (org_id, email, password_hash, full_name, role, active) VALUES ($1,$2,$3,$4,$5,true) RETURNING id, email, full_name, role, active',
    [orgId || user.org_id, email.toLowerCase().trim(), hash, fullName || email, role || 'user']
  );
  return { user: newUser };
}

async function updateUser(body, user, userId) {
  await requireAdmin(user);
  const { fullName, email, role, active, password, orgId } = body;
  let hash = null;
  if (password) hash = await bcrypt.hash(password, 10);
  const updated = await queryOne(
    `UPDATE users SET
      full_name = COALESCE($1, full_name),
      email = COALESCE($2, email),
      role = COALESCE($3, role),
      active = COALESCE($4, active),
      org_id = COALESCE($5, org_id),
      password_hash = CASE WHEN $6::text IS NOT NULL THEN $6::text ELSE password_hash END,
      updated_at = NOW()
    WHERE id = $7 RETURNING id, email, full_name, role, active`,
    [fullName || null, email ? email.toLowerCase().trim() : null, role || null,
     active !== undefined ? active : null, orgId || null, hash, userId]
  );
  if (!updated) throw { status: 404, message: 'User not found' };
  return { user: updated };
}

module.exports = { getOrganisations, createOrganisation, updateOrganisation, getUsers, createUser, updateUser };
