/* HGVDesk shared utilities — api(), toast(), mobile bar toggle */
var KEY = (window.HGV_CONFIG && window.HGV_CONFIG.apiKey) || '';

function api(method, path, body) {
  var opts = {method: method, headers: {'Content-Type': 'application/json', 'X-API-Key': KEY}};
  if (body) opts.body = JSON.stringify(body);
  return fetch('/api' + path, opts).then(function(r) { return r.json(); }).catch(function() { return null; });
}

var _toastTimer;
function toast(icon, msg) {
  var ti = document.getElementById('ti');
  var tm = document.getElementById('tm');
  var t = document.getElementById('toast');
  if (!ti || !tm || !t) return;
  ti.textContent = icon;
  tm.textContent = msg;
  t.classList.add('v');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { t.classList.remove('v'); }, 3200);
}

(function initMobileBar() {
  var b = document.getElementById('mobile-bar');
  var o = document.getElementById('mobile-overlay');
  if (!b) return;
  function s() { return document.querySelector('.sidebar'); }
  b.addEventListener('click', function() { s().classList.toggle('open'); o.classList.toggle('on'); });
  if (o) o.addEventListener('click', function() { s().classList.remove('open'); o.classList.remove('on'); });
})();
