// White-label branding swap — loads after config.js
// Replaces sidebar logo + name with org logo if available
(function() {
  var cfg = window.HGV_CONFIG || {};
  if (!cfg.logoLight) return;
  // Swap sidebar top
  var top = document.querySelector('.sb-top');
  if (top) {
    top.innerHTML = '<a href="/command" style="display:block;"><img src="' + cfg.logoLight + '" style="max-height:36px;width:auto;" alt="' + (cfg.orgName || '') + '"></a>';
    top.style.padding = '14px 16px';
  }
  // Swap mobile bar title
  var mt = document.querySelector('.mb-title');
  if (mt && cfg.orgName) mt.textContent = cfg.orgName;
})();
