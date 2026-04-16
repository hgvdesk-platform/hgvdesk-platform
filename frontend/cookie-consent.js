(function() {
  if (localStorage.getItem('hgvdesk_cookies') === 'ok') return;
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1e293b;color:#f1f5f9;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;z-index:9999;font-family:system-ui,sans-serif;font-size:13px;box-shadow:0 -2px 8px rgba(0,0,0,0.2);';
  b.innerHTML = '<span>We use essential cookies only. By using HGVDesk you agree to our <a href="/privacy" style="color:#60a5fa;text-decoration:underline;">Privacy Policy</a>.</span><button id="ck-ok" style="background:#2563eb;color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;">Accept</button>';
  document.body.appendChild(b);
  document.getElementById('ck-ok').onclick = function() { localStorage.setItem('hgvdesk_cookies','ok'); b.remove(); };
})();
