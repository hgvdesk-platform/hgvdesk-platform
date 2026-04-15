const { queryOne, query } = require('../db');

async function getSettings(org) {
  const orgId = org.id || org.org_id;
  let settings = await queryOne('SELECT * FROM org_settings WHERE org_id = $1', [orgId]);
  if (!settings) {
    const orgRow = await queryOne('SELECT name FROM organisations WHERE id = $1', [orgId]);
    settings = await queryOne(
      'INSERT INTO org_settings (org_id, company_name) VALUES ($1, $2) RETURNING *',
      [orgId, orgRow ? orgRow.name : '']
    );
  }
  return { settings };
}

async function saveSettings(body, org) {
  const orgId = org.id || org.org_id;
  const {
    companyName, companyAddress, vatNumber, companyEmail, phone,
    bankName, sortCode, accountNumber, logoUrl, paymentTerms, invoiceFooter
  } = body;
  const settings = await queryOne(
    `INSERT INTO org_settings (org_id, company_name, company_address, vat_number, company_email,
       phone, bank_name, sort_code, account_number, logo_url, payment_terms, invoice_footer, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (org_id) DO UPDATE SET
       company_name = COALESCE($2, org_settings.company_name),
       company_address = COALESCE($3, org_settings.company_address),
       vat_number = COALESCE($4, org_settings.vat_number),
       company_email = COALESCE($5, org_settings.company_email),
       phone = COALESCE($6, org_settings.phone),
       bank_name = COALESCE($7, org_settings.bank_name),
       sort_code = COALESCE($8, org_settings.sort_code),
       account_number = COALESCE($9, org_settings.account_number),
       logo_url = COALESCE($10, org_settings.logo_url),
       payment_terms = COALESCE($11, org_settings.payment_terms),
       invoice_footer = COALESCE($12, org_settings.invoice_footer),
       updated_at = NOW()
     RETURNING *`,
    [orgId, companyName || null, companyAddress || null, vatNumber || null,
     companyEmail || null, phone || null, bankName || null, sortCode || null,
     accountNumber || null, logoUrl || null, paymentTerms || 30, invoiceFooter || null]
  );
  return { settings };
}

module.exports = { getSettings, saveSettings };
