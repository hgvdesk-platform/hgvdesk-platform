/**
 * HGVDESK — STRIPE BILLING ROUTES
 *
 * Public:
 *   POST /api/auth/signup            — register org + admin user, return Checkout URL
 *   POST /api/stripe/webhook         — Stripe webhook receiver (signature-verified)
 *
 * Authed:
 *   GET  /api/billing/plans          — list plans + price IDs
 *   GET  /api/billing/me             — current org subscription state
 */
const Stripe = require('stripe');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { queryOne, query } = require('../db');
const { signToken } = require('../auth');

const SECRET = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = SECRET ? new Stripe(SECRET) : null;
const STRIPE_MODE = SECRET ? (SECRET.startsWith('sk_live_') ? 'live' : 'test') : 'unconfigured';
if (stripe) console.log(`[STRIPE] ${STRIPE_MODE.toUpperCase()} mode`);

function getBillingMode() {
  return { mode: STRIPE_MODE, ready: !!stripe };
}

// Plan catalog. Single source of truth — read by signup, frontend, and limit enforcement.
const PLANS = {
  starter: {
    key: 'starter',
    name: 'Starter',
    priceId: process.env.STRIPE_PRICE_STARTER,
    amountGbp: 49,
    vehicleLimit: 10,
    features: ['Up to 10 vehicles', 'Workshop + Inspect + Parts', 'Email reports', 'AI defect assistant'],
  },
  professional: {
    key: 'professional',
    name: 'Professional',
    priceId: process.env.STRIPE_PRICE_PROFESSIONAL,
    amountGbp: 99,
    vehicleLimit: 50,
    features: ['Up to 50 vehicles', 'Everything in Starter', 'Priority support', 'Custom job library'],
  },
  enterprise: {
    key: 'enterprise',
    name: 'Enterprise',
    priceId: process.env.STRIPE_PRICE_ENTERPRISE,
    amountGbp: 199,
    vehicleLimit: null, // unlimited
    features: ['Unlimited vehicles', 'Everything in Professional', 'SLA + onboarding', 'Multi-site'],
  },
};

function publicPlans() {
  return Object.values(PLANS).map(p => ({
    key: p.key,
    name: p.name,
    amountGbp: p.amountGbp,
    vehicleLimit: p.vehicleLimit,
    features: p.features,
  }));
}

function getPlan(key) {
  return PLANS[key];
}

function ensureStripe() {
  if (!stripe) throw new AppError(503, 'Billing not configured (STRIPE_SECRET_KEY missing)');
}

// Used in handleStripeWebhook below — handlers receive the raw body for signature verification.

async function signup(body) {
  ensureStripe();
  const { orgName, fullName, email, password, plan: planKey } = body || {};
  if (!orgName || !email || !password || !fullName) {
    throw new AppError(400, 'orgName, fullName, email, password are required');
  }
  const plan = getPlan(planKey || 'starter');
  if (!plan) throw new AppError(400, 'Invalid plan');
  if (!plan.priceId) throw new AppError(503, `Plan "${plan.key}" has no Stripe price configured`);

  const normEmail = email.toLowerCase().trim();
  const existingUser = await queryOne('SELECT id FROM users WHERE email = $1', [normEmail]);
  if (existingUser) throw new AppError(409, 'A user with that email already exists');

  // Generate a stable slug from the org name; append a short random suffix on collision.
  const baseSlug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'org';
  let slug = baseSlug;
  for (let i = 0; i < 5; i++) {
    const clash = await queryOne('SELECT id FROM organisations WHERE slug = $1', [slug]);
    if (!clash) break;
    slug = baseSlug + '-' + crypto.randomBytes(2).toString('hex');
  }

  const apiKey = crypto.randomBytes(16).toString('hex');
  const passwordHash = await bcrypt.hash(password, 10);

  // Create the Stripe customer first so we can store the id alongside the org.
  const customer = await stripe.customers.create({
    email: normEmail,
    name: orgName,
    metadata: { hgvdesk_signup: '1' },
  });

  // Insert org as INACTIVE — webhook flips active=true after payment.
  const org = await queryOne(
    `INSERT INTO organisations
      (name, slug, plan, api_key, active, stripe_customer_id, subscription_status, billing_email)
     VALUES ($1, $2, $3, $4, false, $5, $6, $7)
     RETURNING id, name, slug, plan, api_key, active`,
    [orgName, slug, plan.key, apiKey, customer.id, 'pending', normEmail]
  );

  const verifyToken = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO users (org_id, email, password_hash, full_name, role, active, email_verified, verify_token)
     VALUES ($1, $2, $3, $4, 'admin', true, false, $5)`,
    [org.id, normEmail, passwordHash, fullName, verifyToken]
  );

  // Send verification email
  const origin = process.env.PUBLIC_BASE_URL || 'https://hgvdesk.co.uk';
  try {
    const { resendSend } = require('../mailer');
    await resendSend({
      from: process.env.FROM_EMAIL || 'noreply@hgvdesk.co.uk',
      to: [normEmail],
      subject: 'HGVDesk — Verify your email',
      html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;"><h2 style="color:#0a1929;">Welcome to HGVDesk</h2><p>Click below to verify your email address and activate your account.</p><a href="' + origin + '/api/auth/verify-email?token=' + verifyToken + '" style="display:inline-block;padding:12px 24px;background:#ff5500;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Verify email</a></div>'
    });
  } catch (e) { console.error('[SIGNUP] verify email failed:', e.message); }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    line_items: [{ price: plan.priceId, quantity: 1 }],
    success_url: `${origin}/signup-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/signup?cancelled=1`,
    subscription_data: {
      metadata: { hgvdesk_org_id: String(org.id), hgvdesk_plan: plan.key },
    },
    metadata: { hgvdesk_org_id: String(org.id), hgvdesk_plan: plan.key },
    allow_promotion_codes: true,
  });

  return {
    checkoutUrl: session.url,
    orgId: org.id,
    plan: plan.key,
  };
}

async function getMyBilling(caller) {
  const orgId = caller.org_id || caller.id;
  const org = await queryOne(
    `SELECT id, name, plan, active, subscription_status, stripe_customer_id, stripe_subscription_id,
            billing_email, trial_ends_at
     FROM organisations WHERE id = $1`,
    [orgId]
  );
  if (!org) throw new AppError(404, 'Organisation not found');
  const plan = getPlan(org.plan) || null;
  return {
    organisation: org,
    plan: plan ? { key: plan.key, name: plan.name, vehicleLimit: plan.vehicleLimit } : null,
  };
}

// ── Webhook handling ─────────────────────────────────────────────

function constructEvent(rawBody, signatureHeader) {
  if (!stripe) throw new AppError(503, 'Billing not configured');
  if (!WEBHOOK_SECRET) {
    // Refuse to accept unsigned webhooks. Better to fail loudly than silently trust input.
    throw new AppError(503, 'STRIPE_WEBHOOK_SECRET not configured');
  }
  try {
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, WEBHOOK_SECRET);
  } catch (err) {
    throw new AppError(400, `Webhook signature verification failed: ${err.message}`);
  }
}

async function setOrgActiveByCustomer(customerId, isActive, status, subscriptionId) {
  await query(
    `UPDATE organisations
       SET active = $1,
           subscription_status = $2,
           stripe_subscription_id = COALESCE($3, stripe_subscription_id),
           updated_at = NOW()
     WHERE stripe_customer_id = $4`,
    [isActive, status, subscriptionId || null, customerId]
  );
}

async function handleEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.metadata?.invoice_id) {
        await query(
          "UPDATE invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1",
          [Number.parseInt(session.metadata.invoice_id)]
        );
        console.log('[STRIPE] Invoice payment received:', session.metadata.invoice_id);
      } else if (session.mode === 'subscription' && session.customer) {
        await setOrgActiveByCustomer(session.customer, true, 'active', session.subscription);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const isActive = sub.status === 'active' || sub.status === 'trialing';
      await setOrgActiveByCustomer(sub.customer, isActive, sub.status, sub.id);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await setOrgActiveByCustomer(sub.customer, false, 'canceled', sub.id);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      // Don't deactivate on first failure — Stripe retries; subscription.updated will eventually
      // flip to past_due/unpaid/canceled.
      await setOrgActiveByCustomer(invoice.customer, true, 'past_due', null);
      break;
    }
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      await setOrgActiveByCustomer(invoice.customer, true, 'active', null);
      break;
    }
    default:
      console.log('[STRIPE] unhandled event type:', event.type);
  }
}

async function webhook(rawBody, signatureHeader) {
  const event = constructEvent(rawBody, signatureHeader);
  await handleEvent(event);
  return { received: true, type: event.type };
}

// Plan limit enforcement helper — called by workshop.createJob.
async function countDistinctVehicles(orgId) {
  const row = await queryOne(
    `SELECT COUNT(DISTINCT vehicle_reg) AS n FROM jobs WHERE org_id = $1`,
    [orgId]
  );
  return Number.parseInt(row && row.n, 10) || 0;
}

async function enforceVehicleLimit(orgId, planKey, candidateReg) {
  const plan = getPlan(planKey);
  if (!plan || plan.vehicleLimit == null) return; // unlimited or unknown plan
  // If the reg already exists for this org, no new vehicle is being added.
  if (candidateReg) {
    const exists = await queryOne(
      `SELECT 1 FROM jobs WHERE org_id = $1 AND vehicle_reg = $2 LIMIT 1`,
      [orgId, candidateReg]
    );
    if (exists) return;
  }
  const current = await countDistinctVehicles(orgId);
  if (current >= plan.vehicleLimit) {
    throw new AppError(402, `Vehicle limit reached for ${plan.name} plan (${plan.vehicleLimit}). Upgrade to add more.`);
  }
}

// ── Invoice Payment Links ────────────────────────────────────────

async function generateInvoicePaymentLink(invoiceId, orgId) {
  ensureStripe();
  const invoice = await queryOne(
    'SELECT * FROM invoices WHERE id = $1 AND org_id = $2', [invoiceId, orgId]
  );
  if (!invoice) throw new AppError(404, 'Invoice not found');
  if (invoice.stripe_payment_link_url) return { paymentLinkUrl: invoice.stripe_payment_link_url };

  const totalPence = Math.round(Number.parseFloat(invoice.total) * 100);
  if (totalPence <= 0) throw new AppError(400, 'Invoice total must be greater than zero');

  const appUrl = process.env.PUBLIC_BASE_URL || 'https://hgvdesk.co.uk';

  const price = await stripe.prices.create({
    currency: 'gbp',
    unit_amount: totalPence,
    product_data: { name: `Invoice ${invoice.invoice_number}` },
  });

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    after_completion: {
      type: 'redirect',
      redirect: { url: `${appUrl}/payment-complete?invoice=${invoiceId}` },
    },
    metadata: { invoice_id: String(invoiceId), org_id: String(orgId) },
  });

  await query(
    'UPDATE invoices SET stripe_payment_link_id = $1, stripe_payment_link_url = $2, updated_at = NOW() WHERE id = $3',
    [link.id, link.url, invoiceId]
  );

  return { paymentLinkUrl: link.url, paymentLinkId: link.id };
}

module.exports = {
  PLANS,
  publicPlans,
  getPlan,
  signup,
  getMyBilling,
  webhook,
  enforceVehicleLimit,
  generateInvoicePaymentLink,
  getBillingMode,
};
