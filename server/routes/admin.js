/**
 * HGVDESK — ADMIN ROUTES
 *
 * All endpoints in this file are PLATFORM-ADMIN only (HGVDesk staff).
 * Tenant orgs cannot list, create, or modify other tenants.
 */
const { queryAll, queryOne, query } = require('../db');
const { requirePlatformAdmin } = require('../auth');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');

async function getOrganisations(caller) {
  requirePlatformAdmin(caller);
  const orgs = await queryAll('SELECT * FROM organisations ORDER BY created_at DESC', []);
  return { organisations: orgs };
}

async function createOrganisation(body, caller) {
  requirePlatformAdmin(caller);
  const { name, plan } = body;
  if (!name) throw new AppError(400, 'name is required');
  const apiKey = crypto.randomBytes(16).toString('hex');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
  const org = await queryOne(
    'INSERT INTO organisations (name, slug, plan, api_key, active) VALUES ($1,$2,$3,$4,true) RETURNING *',
    [name, slug, plan || 'starter', apiKey]
  );
  return { organisation: org };
}

async function updateOrganisation(body, caller, orgId) {
  requirePlatformAdmin(caller);
  const { name, plan, active } = body;
  const org = await queryOne(
    'UPDATE organisations SET name=COALESCE($1,name), plan=COALESCE($2,plan), active=COALESCE($3,active), updated_at=NOW() WHERE id=$4 RETURNING *',
    [name || null, plan || null, active !== undefined ? active : null, orgId]
  );
  if (!org) throw new AppError(404, 'Organisation not found');
  return { organisation: org };
}

async function getUsers(caller) {
  requirePlatformAdmin(caller);
  const users = await queryAll(
    'SELECT id, org_id, email, full_name, role, is_platform_admin, active, created_at, last_login FROM users ORDER BY created_at DESC',
    []
  );
  return { users };
}

async function createUser(body, caller) {
  requirePlatformAdmin(caller);
  const { email, password, fullName, orgId, role } = body;
  if (!email || !password) throw new AppError(400, 'email and password required');
  if (!orgId) throw new AppError(400, 'orgId is required');
  const hash = await bcrypt.hash(password, 10);
  const newUser = await queryOne(
    'INSERT INTO users (org_id, email, password_hash, full_name, role, active) VALUES ($1,$2,$3,$4,$5,true) RETURNING id, email, full_name, role, active',
    [orgId, email.toLowerCase().trim(), hash, fullName || email, role || 'user']
  );
  return { user: newUser };
}

async function updateUser(body, caller, userId) {
  requirePlatformAdmin(caller);
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
  if (!updated) throw new AppError(404, 'User not found');
  return { user: updated };
}

module.exports = { getOrganisations, createOrganisation, updateOrganisation, getUsers, createUser, updateUser };
