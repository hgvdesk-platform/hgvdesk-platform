/**
 * HGV PLATFORM — CUSTOMERS & INVOICES ROUTES
 */
const { queryOne, queryAll, query } = require('../db');

async function logActivity(orgId, system, event, detail, entityType = null, entityId = null) {
  await query(
    'INSERT INTO activity_log (org_id, system, event, detail, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [orgId, system, event, detail, entityType, entityId]
  );
}

// ── CUSTOMERS ──
async function getCustomers(org) {
  const orgId = org.id || org.org_id;
  const customers = await queryAll('SELECT * FROM customers WHERE org_id = $1 ORDER BY name ASC', [orgId]);
  return { customers };
}

async function createCustomer(body, org) {
  const orgId = org.id || org.org_id;
  const { name, contactName, email, phone, address, labourRate, paymentTerms, notes } = body;
  if (!name) throw { status: 400, message: 'name is required' };
  const customer = await queryOne(
    `INSERT INTO customers (org_id, name, contact_name, email, phone, address, labour_rate, payment_terms, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [orgId, name, contactName || null, email || null, phone || null, address || null,
     labourRate || 75.00, paymentTerms || 30, notes || null]
  );
  await logActivity(orgId, 'CUSTOMERS', 'CUSTOMER_CREATED', name, 'customer', customer.id);
  return { customer };
}

async function updateCustomer(body, org, customerId) {
  const orgId = org.id || org.org_id;
  const existing = await queryOne('SELECT * FROM customers WHERE id = $1 AND org_id = $2', [customerId, orgId]);
  if (!existing) throw { status: 404, message: 'Customer not found' };
  const { name, contactName, email, phone, address, labourRate, paymentTerms, notes, active } = body;
  const customer = await queryOne(
    `UPDATE customers SET
      name = COALESCE($1, name),
      contact_name = COALESCE($2, contact_name),
      email = COALESCE($3, email),
      phone = COALESCE($4, phone),
      address = COALESCE($5, address),
      labour_rate = COALESCE($6, labour_rate),
      payment_terms = COALESCE($7, payment_terms),
      notes = COALESCE($8, notes),
      active = COALESCE($9, active),
      updated_at = NOW()
    WHERE id = $10 AND org_id = $11 RETURNING *`,
    [name || null, contactName || null, email || null, phone || null, address || null,
     labourRate || null, paymentTerms || null, notes || null,
     active !== undefined ? active : null, customerId, orgId]
  );
  return { customer };
}

async function deleteCustomer(org, customerId) {
  const orgId = org.id || org.org_id;
  const existing = await queryOne('SELECT id FROM customers WHERE id = $1 AND org_id = $2', [customerId, orgId]);
  if (!existing) throw { status: 404, message: 'Customer not found' };
  await query('DELETE FROM customers WHERE id = $1 AND org_id = $2', [customerId, orgId]);
  return { deleted: true };
}

// ── INVOICES ──
async function getInvoices(org, queryParams) {
  const orgId = org.id || org.org_id;
  let sql = `SELECT i.*, c.name as customer_name_from_table, c.email as customer_email_from_table
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.org_id = $1`;
  const params = [orgId];
  if (queryParams.status) { params.push(queryParams.status); sql += ' AND i.status = $' + params.length; }
  if (queryParams.customerId) { params.push(queryParams.customerId); sql += ' AND i.customer_id = $' + params.length; }
  sql += ' ORDER BY i.created_at DESC';
  const invoices = await queryAll(sql, params);
  return { invoices };
}

async function getInvoice(org, invoiceId) {
  const orgId = org.id || org.org_id;
  const invoice = await queryOne(
    `SELECT i.*, c.name as customer_name_full, c.email as customer_email_full,
      c.address as customer_address, c.phone as customer_phone, c.labour_rate
     FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.id = $1 AND i.org_id = $2`,
    [invoiceId, orgId]
  );
  if (!invoice) throw { status: 404, message: 'Invoice not found' };
  const lines = await queryAll('SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY id ASC', [invoiceId]);
  return { invoice, lines };
}

async function createInvoice(body, org) {
  const orgId = org.id || org.org_id;
  const { customerId, jobId, lines = [], notes, issueDate, paymentTerms } = body;

  // Get customer details
  let customer = null;
  if (customerId) {
    customer = await queryOne('SELECT * FROM customers WHERE id = $1 AND org_id = $2', [customerId, orgId]);
  }

  // Generate invoice number
  const count = await queryOne('SELECT COUNT(*) as c FROM invoices WHERE org_id = $1', [orgId]);
  const invoiceNum = 'INV-' + String(parseInt(count.c) + 1).padStart(4, '0');

  // Pull org settings for defaults
  const orgSettings = await queryOne('SELECT * FROM org_settings WHERE org_id = $1', [orgId]);
  const terms = paymentTerms || (customer && customer.payment_terms) || (orgSettings && orgSettings.payment_terms) || 30;
  const issue = issueDate ? new Date(issueDate) : new Date();
  const due = new Date(issue);
  due.setDate(due.getDate() + terms);

  // Calculate totals
  let subtotal = 0;
  lines.forEach(function(l) { subtotal += parseFloat(l.lineTotal || (l.quantity * l.unitPrice) || 0); });
  const vatAmount = Math.round(subtotal * 0.20 * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;

  const invoice = await queryOne(
    `INSERT INTO invoices (org_id, invoice_number, customer_id, job_id, customer_name, customer_email,
      vehicle_reg, status, issue_date, due_date, subtotal, vat_amount, total, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13) RETURNING *`,
    [orgId, invoiceNum, customerId || null, jobId || null,
     customer ? customer.name : (body.customerName || null),
     customer ? customer.email : (body.customerEmail || null),
     body.vehicleReg || null,
     issue.toISOString().split('T')[0],
     due.toISOString().split('T')[0],
     subtotal, vatAmount, total, notes || null]
  );

  // Insert lines
  for (const line of lines) {
    const qty = parseFloat(line.quantity || 1);
    const unitPrice = parseFloat(line.unitPrice || 0);
    const lineTotal = Math.round(qty * unitPrice * 100) / 100;
    await query(
      `INSERT INTO invoice_lines (org_id, invoice_id, type, description, quantity, unit_price, line_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orgId, invoice.id, line.type || 'labour', line.description || '', qty, unitPrice, lineTotal]
    );
  }

  // Update job if linked
  if (jobId) {
    await query('UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3',
      ['invoiced', jobId, orgId]);
  }

  await logActivity(orgId, 'INVOICES', 'INVOICE_CREATED', invoiceNum, 'invoice', invoice.id);
  return { invoice, invoiceNumber: invoiceNum };
}

async function updateInvoiceStatus(body, org, invoiceId) {
  const orgId = org.id || org.org_id;
  const { status } = body;
  const validStatuses = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];
  if (!validStatuses.includes(status)) throw { status: 400, message: 'Invalid status' };
  const updates = { status };
  if (status === 'paid') updates.paid_at = new Date().toISOString();
  if (status === 'sent') updates.sent_at = new Date().toISOString();
  const invoice = await queryOne(
    `UPDATE invoices SET status = $1,
      paid_at = CASE WHEN $2 THEN NOW() ELSE paid_at END,
      sent_at = CASE WHEN $3 THEN NOW() ELSE sent_at END,
      updated_at = NOW()
     WHERE id = $4 AND org_id = $5 RETURNING *`,
    [status, status === 'paid', status === 'sent', invoiceId, orgId]
  );
  if (!invoice) throw { status: 404, message: 'Invoice not found' };
  await logActivity(orgId, 'INVOICES', 'INVOICE_STATUS_CHANGED', invoice.invoice_number + ' → ' + status, 'invoice', invoiceId);
  return { invoice };
}

async function deleteInvoice(org, invoiceId) {
  const orgId = org.id || org.org_id;
  const existing = await queryOne('SELECT id, invoice_number FROM invoices WHERE id = $1 AND org_id = $2', [invoiceId, orgId]);
  if (!existing) throw { status: 404, message: 'Invoice not found' };
  await query('DELETE FROM invoices WHERE id = $1 AND org_id = $2', [invoiceId, orgId]);
  await logActivity(orgId, 'INVOICES', 'INVOICE_DELETED', existing.invoice_number + ' deleted');
  return { deleted: true };
}

// Auto-generate invoice from completed job
async function generateFromJob(body, org) {
  const orgId = org.id || org.org_id;
  const { jobId } = body;
  if (!jobId) throw { status: 400, message: 'jobId required' };

  const job = await queryOne('SELECT * FROM jobs WHERE id = $1 AND org_id = $2', [jobId, orgId]);
  if (!job) throw { status: 404, message: 'Job not found' };

  // Get customer by name match or customer_id
  let customer = null;
  if (job.customer_id) {
    customer = await queryOne('SELECT * FROM customers WHERE id = $1 AND org_id = $2', [job.customer_id, orgId]);
  } else if (job.customer_name) {
    customer = await queryOne('SELECT * FROM customers WHERE org_id = $1 AND LOWER(name) LIKE $2 LIMIT 1',
      [orgId, '%' + job.customer_name.toLowerCase() + '%']);
  }

  const labourRate = customer ? parseFloat(customer.labour_rate || 65) : 65.00;

  const jobLines = await queryAll(
    'SELECT * FROM job_lines WHERE job_id = $1 AND org_id = $2 ORDER BY created_at ASC', [jobId, orgId]
  );
  const parts = await queryAll(
    'SELECT * FROM parts WHERE job_id = $1 AND org_id = $2', [jobId, orgId]
  );

  const lines = [];

  // Labour from job_lines (sold hours library items)
  if (jobLines.length > 0) {
    jobLines.forEach(function(jl) {
      const hrs = parseFloat(jl.sold_hours || 0) * parseFloat(jl.quantity || 1);
      lines.push({
        type: 'labour',
        description: 'Workshop Labour — ' + (jl.name || jl.description || 'Service') + ' (' + hrs.toFixed(1) + ' hrs @ £' + labourRate.toFixed(2) + '/hr)',
        quantity: hrs,
        unitPrice: labourRate,
        lineTotal: hrs * labourRate
      });
    });
  } else if (parseFloat(job.sold_hours || 0) > 0) {
    // Fallback: use job-level sold_hours
    const hrs = parseFloat(job.sold_hours);
    lines.push({
      type: 'labour',
      description: 'Workshop Labour — ' + (job.inspection_type || 'Service') + ' ' + job.vehicle_reg + ' (' + hrs.toFixed(1) + ' hrs @ £' + labourRate.toFixed(2) + '/hr)',
      quantity: hrs,
      unitPrice: labourRate,
      lineTotal: hrs * labourRate
    });
  } else {
    // Minimal fallback: single inspection charge
    lines.push({
      type: 'labour',
      description: (job.inspection_type || 'Workshop Service') + ' — ' + job.vehicle_reg,
      quantity: 1,
      unitPrice: labourRate,
      lineTotal: labourRate
    });
  }

  // Parts as individual line items
  parts.forEach(function(p) {
    const qty = parseInt(p.qty || 1);
    const cost = parseFloat(p.unit_cost || 0);
    lines.push({
      type: 'parts',
      description: p.name + (p.part_number ? ' — ' + p.part_number : '') + (p.part_id ? ' (' + p.part_id + ')' : ''),
      quantity: qty,
      unitPrice: cost,
      lineTotal: qty * cost
    });
  });

  return createInvoice({
    customerId: customer ? customer.id : null,
    customerName: job.customer_name,
    customerEmail: customer ? customer.email : null,
    jobId: jobId,
    vehicleReg: job.vehicle_reg,
    lines: lines,
    notes: 'Vehicle: ' + job.vehicle_reg + ' · Job: ' + (job.job_number || jobId) + (job.notes ? ' · ' + job.notes : '')
  }, org);
}

async function bulkDeleteInvoices(org, ids) {
  const orgId = org.id || org.org_id;
  if (!Array.isArray(ids) || !ids.length) throw { status: 400, message: 'ids array required' };
  const result = await query('DELETE FROM invoices WHERE id = ANY($1::int[]) AND org_id = $2', [ids, orgId]);
  await logActivity(orgId, 'BILLING', 'INVOICES_BULK_DELETED', result.rowCount + ' invoices deleted');
  return { deleted: result.rowCount };
}

async function bulkDeleteCustomers(org, ids) {
  const orgId = org.id || org.org_id;
  if (!Array.isArray(ids) || !ids.length) throw { status: 400, message: 'ids array required' };
  const result = await query('DELETE FROM customers WHERE id = ANY($1::int[]) AND org_id = $2', [ids, orgId]);
  await logActivity(orgId, 'BILLING', 'CUSTOMERS_BULK_DELETED', result.rowCount + ' customers deleted');
  return { deleted: result.rowCount };
}

module.exports = {
  getCustomers, createCustomer, updateCustomer, deleteCustomer, bulkDeleteCustomers,
  getInvoices, getInvoice, createInvoice, updateInvoiceStatus, deleteInvoice, bulkDeleteInvoices, generateFromJob
};
