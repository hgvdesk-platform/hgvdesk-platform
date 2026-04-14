(function() {
  const cfg = window.HGV_CONFIG || {};
  if (!cfg.logoLight) return;
  const top = document.querySelector('.sb-top');
  if (top) {
    top.innerHTML = '<a href="/command" style="display:block;"><img src="' + cfg.logoLight + '" style="max-height:36px;width:auto;" alt="' + (cfg.orgName || '') + '"></a>';
    top.style.padding = '14px 16px';
  }
  const mt = document.querySelector('.mb-title');
  if (mt && cfg.orgName) mt.textContent = cfg.orgName;
})();
