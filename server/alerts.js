/**
 * HGVDESK — Automated Alert System
 * Runs daily checks and creates notifications + sends emails.
 * Called by cron or on-demand via GET /api/admin/run-alerts.
 */
const { queryAll, queryOne, query } = require('./db');

async function createNotification(orgId, type, severity, title, detail, entityType, entityId, link) {
  const existing = await queryOne(
    'SELECT id FROM notifications WHERE org_id=$1 AND type=$2 AND entity_type=$3 AND entity_id=$4 AND created_at > NOW() - INTERVAL \'24 hours\'',
    [orgId, type, entityType || null, entityId || null]
  );
  if (existing) return null;
  return queryOne(
    'INSERT INTO notifications (org_id, type, severity, title, detail, entity_type, entity_id, link) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [orgId, type, severity, title, detail || null, entityType || null, entityId || null, link || null]
  );
}

async function getOrgAdmin(orgId) {
  return queryOne("SELECT email, full_name FROM users WHERE org_id=$1 AND role='admin' AND active=true ORDER BY id LIMIT 1", [orgId]);
}

async function sendAlertEmail(to, subject, body) {
  try {
    const { resendSend } = require('./mailer');
    await resendSend({
      from: process.env.FROM_EMAIL || 'noreply@hgvdesk.co.uk',
      to: Array.isArray(to) ? to : [to],
      subject: 'HGVDesk Alert: ' + subject,
      html: '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">' +
        '<div style="background:#0a1929;padding:14px 20px;border-radius:8px 8px 0 0;"><span style="color:#ff5500;font-weight:700;font-size:15px;">HGV</span><span style="color:#fff;font-weight:700;font-size:15px;">Desk</span><span style="color:rgba(255,255,255,0.5);font-size:12px;margin-left:8px;">Alert</span></div>' +
        '<div style="border:1px solid #e8e8e8;border-top:none;border-radius:0 0 8px 8px;padding:20px;">' + body + '</div>' +
        '<div style="text-align:center;margin-top:12px;font-size:11px;color:#999;">hgvdesk.co.uk</div></div>'
    });
    return true;
  } catch (e) {
    console.error('[ALERTS] Email failed:', e.message);
    return false;
  }
}

async function checkMotAlerts() {
  const results = [];
  const vehicles = await queryAll(`
    SELECT v.*, o.id as org_id FROM vehicles v
    JOIN organisations o ON v.org_id = o.id
    WHERE v.active = true AND v.mot_expiry IS NOT NULL AND o.active = true
  `);

  for (const v of vehicles) {
    const days = Math.floor((new Date(v.mot_expiry) - new Date()) / 86400000);
    if (days > 30) continue;

    let severity, title;
    if (days < 0) {
      severity = 'critical';
      title = v.registration + ' MOT EXPIRED (' + Math.abs(days) + ' days ago)';
    } else if (days <= 7) {
      severity = 'urgent';
      title = v.registration + ' MOT expires in ' + days + ' day(s)';
    } else {
      severity = 'warning';
      title = v.registration + ' MOT expires in ' + days + ' days';
    }

    const n = await createNotification(v.org_id, 'mot_expiry', severity, title,
      (v.make || '') + ' ' + (v.model || '') + ' — MOT: ' + new Date(v.mot_expiry).toLocaleDateString('en-GB'),
      'vehicle', v.id, '/vehicles');

    if (n && (severity === 'critical' || severity === 'urgent')) {
      const admin = await getOrgAdmin(v.org_id);
      if (admin) {
        const color = severity === 'critical' ? '#ff3b30' : '#ff9500';
        await sendAlertEmail(admin.email, title,
          '<p style="font-size:14px;color:' + color + ';font-weight:700;">' + title + '</p>' +
          '<p>' + (v.make || '') + ' ' + (v.model || '') + '</p>' +
          '<p style="margin-top:12px;"><a href="https://hgvdesk.co.uk/vehicles" style="background:#ff5500;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View Vehicles</a></p>');
        await query('UPDATE notifications SET emailed=true WHERE id=$1', [n.id]);
      }
    }
    results.push({ type: 'mot', vehicle: v.registration, severity, days });
  }
  return results;
}

async function checkServiceAlerts() {
  const results = [];
  const vehicles = await queryAll(`
    SELECT v.*, o.id as org_id FROM vehicles v
    JOIN organisations o ON v.org_id = o.id
    WHERE v.active = true AND v.service_due IS NOT NULL AND o.active = true
  `);

  for (const v of vehicles) {
    const days = Math.floor((new Date(v.service_due) - new Date()) / 86400000);
    if (days > 14) continue;

    const severity = days < 0 ? 'urgent' : 'warning';
    const title = days < 0
      ? v.registration + ' service OVERDUE (' + Math.abs(days) + ' days)'
      : v.registration + ' service due in ' + days + ' day(s)';

    await createNotification(v.org_id, 'service_due', severity, title,
      (v.make || '') + ' ' + (v.model || ''),
      'vehicle', v.id, '/vehicles');
    results.push({ type: 'service', vehicle: v.registration, severity, days });
  }
  return results;
}

async function checkDefectAlerts() {
  const results = [];
  const defects = await queryAll(`
    SELECT d.*, i.vehicle_reg, i.org_id FROM defects d
    JOIN inspections i ON d.inspection_id = i.id
    WHERE d.resolved = false AND d.severity = 'critical'
  `);

  for (const d of defects) {
    const title = d.vehicle_reg + ' — critical defect outstanding: ' + (d.title || d.description || 'Defect');
    const n = await createNotification(d.org_id, 'critical_defect', 'critical', title,
      d.description, 'defect', d.id, '/inspect');

    if (n) {
      const admin = await getOrgAdmin(d.org_id);
      if (admin) {
        await sendAlertEmail(admin.email, title,
          '<p style="font-size:14px;color:#ff3b30;font-weight:700;">' + (d.vehicle_reg || '') + ' — Critical Defect</p>' +
          '<p>' + (d.description || d.title || '') + '</p>' +
          '<p style="margin-top:12px;"><a href="https://hgvdesk.co.uk/inspect" style="background:#ff5500;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View Inspections</a></p>');
        await query('UPDATE notifications SET emailed=true WHERE id=$1', [n.id]);
      }
    }
    results.push({ type: 'defect', vehicle: d.vehicle_reg, title: d.title });
  }
  return results;
}

async function runAllChecks() {
  console.log('[ALERTS] Running all checks...');
  const mot = await checkMotAlerts();
  const service = await checkServiceAlerts();
  const defects = await checkDefectAlerts();
  const summary = { mot: mot.length, service: service.length, defects: defects.length, timestamp: new Date().toISOString() };
  console.log('[ALERTS] Done:', JSON.stringify(summary));
  return summary;
}

async function getActiveAlerts(org) {
  const orgId = org.id || org.org_id;
  const motExpiring = await queryAll(
    "SELECT id, registration, mot_expiry FROM vehicles WHERE org_id=$1 AND active=true AND mot_expiry IS NOT NULL AND mot_expiry < CURRENT_DATE + 30 ORDER BY mot_expiry", [orgId]);
  const criticalDefects = await queryAll(
    "SELECT d.id, d.title, d.description, i.vehicle_reg FROM defects d JOIN inspections i ON d.inspection_id=i.id WHERE i.org_id=$1 AND d.resolved=false AND d.severity='critical'", [orgId]);
  const offRoad = await queryAll(
    "SELECT id, registration FROM vehicles WHERE org_id=$1 AND status='off-road' AND active=true", [orgId]);
  const recentNotifications = await queryAll(
    "SELECT * FROM notifications WHERE org_id=$1 ORDER BY created_at DESC LIMIT 20", [orgId]);

  return {
    motExpiring: motExpiring,
    criticalDefects: criticalDefects,
    offRoad: offRoad,
    notifications: recentNotifications,
    counts: {
      mot: motExpiring.length,
      defects: criticalDefects.length,
      offRoad: offRoad.length
    }
  };
}

async function getUnreadCount(org) {
  const orgId = org.id || org.org_id;
  const row = await queryOne('SELECT COUNT(*) as c FROM notifications WHERE org_id=$1 AND read=false', [orgId]);
  return { unread: parseInt(row.c) };
}

async function getNotifications(org) {
  const orgId = org.id || org.org_id;
  const notifications = await queryAll(
    'SELECT * FROM notifications WHERE org_id=$1 ORDER BY created_at DESC LIMIT 50', [orgId]);
  return { notifications };
}

async function markRead(org, notificationId) {
  const orgId = org.id || org.org_id;
  await query('UPDATE notifications SET read=true WHERE id=$1 AND org_id=$2', [notificationId, orgId]);
  return { marked: true };
}

async function markAllRead(org) {
  const orgId = org.id || org.org_id;
  await query('UPDATE notifications SET read=true WHERE org_id=$1 AND read=false', [orgId]);
  return { marked: true };
}

module.exports = { runAllChecks, getActiveAlerts, getUnreadCount, getNotifications, markRead, markAllRead };
