/**
 * HGVDESK — PDF generation via Puppeteer
 * Endpoints: GET /api/inspections/:id/pdf, /api/invoices/:id/pdf, /api/jobs/:id/pdf
 */
const { buildInspectionReportHtml, buildInvoiceHtml, buildJobSheetHtml } = require('../report-html');

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    // Lazy require: puppeteer is heavy and its config-dir probe crashes at startup
    // if ProtectHome=true in systemd. Only load when a PDF is actually requested.
    const puppeteer = require('puppeteer');
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
}

async function htmlToPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
    });
    return pdf;
  } finally {
    await page.close();
  }
}

async function getOrgBranding(orgId) {
  const db = require('../db');
  const org = await db.queryOne('SELECT name, logo_light, logo_dark FROM organisations WHERE id = $1', [orgId]);
  return org || {};
}

async function inspectionPdf(inspId, orgId) {
  const db = require('../db');
  const insp = await db.queryOne('SELECT * FROM inspections WHERE id = $1 AND org_id = $2', [inspId, orgId]);
  if (!insp) throw { status: 404, message: 'Inspection not found' };
  insp.defects = await db.queryAll(
    'SELECT * FROM defects WHERE inspection_id = $1 ORDER BY severity DESC, created_at ASC', [insp.id]
  );
  const branding = await getOrgBranding(orgId);
  const html = buildInspectionReportHtml(insp, { orgName: branding.name||'HGVDesk', logoLight: branding.logo_light, logoDark: branding.logo_dark });
  const pdf = await htmlToPdf(html);
  const filename = `${(insp.inspection_id || 'INS').replace(/\s/g, '_')}-${(insp.vehicle_reg || '').replace(/\s/g, '')}.pdf`;
  return { pdf, filename };
}

async function invoicePdf(invoiceId, orgId) {
  const db = require('../db');
  const invoice = await db.queryOne('SELECT * FROM invoices WHERE id = $1 AND org_id = $2', [invoiceId, orgId]);
  if (!invoice) throw { status: 404, message: 'Invoice not found' };
  const lines = await db.queryAll('SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY id ASC', [invoiceId]);
  const branding = await getOrgBranding(orgId);
  const orgSettings = await db.queryOne('SELECT * FROM org_settings WHERE org_id = $1', [orgId]);
  const html = buildInvoiceHtml(invoice, lines, { orgName: branding.name||'HGVDesk', logoLight: branding.logo_light, logoDark: branding.logo_dark, orgSettings: orgSettings || {} });
  const pdf = await htmlToPdf(html);
  const filename = `${(invoice.invoice_number || 'INV').replace(/\s/g, '_')}.pdf`;
  return { pdf, filename };
}

async function jobPdf(jobId, orgId) {
  const db = require('../db');
  const job = await db.queryOne('SELECT * FROM jobs WHERE id = $1 AND org_id = $2', [jobId, orgId]);
  if (!job) throw { status: 404, message: 'Job not found' };
  const insp = await db.queryOne(
    'SELECT * FROM inspections WHERE job_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 1',
    [jobId, orgId]
  );
  if (insp) {
    insp.defects = await db.queryAll('SELECT * FROM defects WHERE inspection_id = $1 ORDER BY severity DESC', [insp.id]);
  }
  const parts = await db.queryAll('SELECT * FROM parts WHERE job_id = $1 AND org_id = $2', [jobId, orgId]);
  const jobLines = await db.queryAll('SELECT * FROM job_lines WHERE job_id = $1 AND org_id = $2 ORDER BY created_at ASC', [jobId, orgId]);
  const branding = await getOrgBranding(orgId);
  const html = buildJobSheetHtml(job, { inspection: insp || null, parts, jobLines, orgName: branding.name||'HGVDesk', logoLight: branding.logo_light, logoDark: branding.logo_dark });
  const filename = `${(job.job_number || 'JOB').replace(/\s/g, '_')}-${(job.vehicle_reg || '').replace(/\s/g, '')}.pdf`;
  const pdf = await htmlToPdf(html);
  return { pdf, filename };
}

module.exports = { inspectionPdf, invoicePdf, jobPdf };
