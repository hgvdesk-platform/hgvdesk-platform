/**
 * HGV PLATFORM — AUTH
 * JWT authentication + API key middleware
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { queryOne, query } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = '8h';

// ═══════════════════════════════════════════════
// TOKEN HELPERS
// ═══════════════════════════════════════════════

function signToken(payload) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not set');
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not set');
  return jwt.verify(token, JWT_SECRET);
}

// ═══════════════════════════════════════════════
// MIDDLEWARE — JWT
// ═══════════════════════════════════════════════

async function requireAuth(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw { status: 401, message: 'Missing or invalid Authorization header' };
  }

  const token = authHeader.slice(7);
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (e) {
    throw { status: 401, message: 'Token invalid or expired' };
  }

  const user = await queryOne(
    `SELECT u.id, u.org_id, u.email, u.full_name, u.role, o.name as org_name, o.plan, o.api_key
     FROM users u JOIN organisations o ON u.org_id = o.id
     WHERE u.id = $1 AND u.active = true AND o.active = true`,
    [decoded.userId]
  );

  if (!user) throw { status: 401, message: 'User not found or inactive' };

  return user;
}

// ═══════════════════════════════════════════════
// MIDDLEWARE — API KEY (for system-to-system calls)
// ═══════════════════════════════════════════════

async function requireApiKey(req) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) throw { status: 401, message: 'Missing X-API-Key header' };

  const org = await queryOne(
    `SELECT id, name, plan, active FROM organisations WHERE api_key = $1`,
    [apiKey]
  );

  if (!org || !org.active) throw { status: 401, message: 'Invalid or inactive API key' };

  return org;
}

// ═══════════════════════════════════════════════
// AUTH — LOGIN
// ═══════════════════════════════════════════════

async function login(email, password) {
  if (!email || !password) throw { status: 400, message: 'Email and password required' };

  const user = await queryOne(
    `SELECT u.*, o.name as org_name, o.plan, o.api_key
     FROM users u JOIN organisations o ON u.org_id = o.id
     WHERE u.email = $1 AND u.active = true AND o.active = true`,
    [email.toLowerCase().trim()]
  );

  if (!user) throw { status: 401, message: 'Invalid email or password' };

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw { status: 401, message: 'Invalid email or password' };

  // Update last login
  await query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);

  const token = signToken({ userId: user.id, orgId: user.org_id, role: user.role });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      orgId: user.org_id,
      orgName: user.org_name,
      plan: user.plan,
      apiKey: user.api_key
    }
  };
}

module.exports = { requireAuth, requireApiKey, login, signToken, verifyToken };
