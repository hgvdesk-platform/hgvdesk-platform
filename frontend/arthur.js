(function() {
  const KEY = (window.HGV_CONFIG && window.HGV_CONFIG.apiKey) || '';
  const history = [];
  let isOpen = false;
  let isLoading = false;

  function getContext() {
    const ctx = {};
    const reg = document.getElementById('f-reg');
    if (reg && reg.value) ctx.vehicleReg = reg.value.trim().toUpperCase();
    const type = document.getElementById('f-type');
    if (type && type.value) ctx.inspectionType = type.value;
    if (window.defects && window.defects.length) {
      ctx.defects = window.defects.map(function(d) {
        return { zone: d.zoneLabel || '', description: d.description || '', severity: d.severity || '' };
      });
    }
    return Object.keys(ctx).length ? ctx : undefined;
  }

  function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function formatMsg(text) {
    let s = esc(text);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/^(\d+)\.\s/gm, '<br><strong>$1.</strong> ');
    s = s.replace(/⚠️/g, '<span style="font-size:15px;">⚠️</span>');
    s = s.replace(/\n\n/g, '<br><br>');
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  function inject() {
    const style = document.createElement('style');
    style.textContent = [
      '#arthur-fab{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:#FF6B00;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(255,107,0,0.35);z-index:9990;display:flex;align-items:center;justify-content:center;transition:transform 0.2s;}',
      '#arthur-fab:hover{transform:scale(1.08);}',
      '#arthur-fab svg{width:26px;height:26px;fill:#fff;}',
      '#arthur-panel{position:fixed;top:0;right:-380px;width:370px;height:100%;background:#fff;box-shadow:-4px 0 24px rgba(0,0,0,0.12);z-index:9991;display:flex;flex-direction:column;transition:right 0.25s ease;font-family:"DM Sans",-apple-system,sans-serif;}',
      '#arthur-panel.open{right:0;}',
      '.ap-hd{background:#1d1d1f;padding:16px 18px;display:flex;align-items:center;gap:12px;flex-shrink:0;}',
      '.ap-avatar{width:40px;height:40px;border-radius:50%;background:#FF6B00;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}',
      '.ap-name{color:#fff;font-size:14px;font-weight:700;}',
      '.ap-sub{color:rgba(255,255,255,0.5);font-size:11px;margin-top:1px;}',
      '.ap-badge{margin-left:auto;font-size:9px;font-weight:700;letter-spacing:0.05em;padding:3px 7px;border-radius:4px;background:rgba(255,107,0,0.15);color:#FF6B00;}',
      '.ap-close{margin-left:8px;background:none;border:none;color:rgba(255,255,255,0.5);font-size:20px;cursor:pointer;padding:4px;}',
      '.ap-close:hover{color:#fff;}',
      '.ap-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;}',
      '.ap-msg{max-width:92%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.55;word-wrap:break-word;}',
      '.ap-msg.user{align-self:flex-end;background:#FF6B00;color:#fff;border-bottom-right-radius:4px;}',
      '.ap-msg.bot{align-self:flex-start;background:#f5f5f7;color:#1d1d1f;border-bottom-left-radius:4px;}',
      '.ap-msg.bot strong{color:#FF6B00;}',
      '.ap-typing{align-self:flex-start;padding:10px 14px;background:#f5f5f7;border-radius:14px;font-size:13px;color:#86868b;font-style:italic;}',
      '.ap-input{border-top:1px solid rgba(0,0,0,0.08);padding:12px;display:flex;gap:8px;flex-shrink:0;background:#fff;}',
      '.ap-input input{flex:1;padding:10px 14px;border:1.5px solid rgba(0,0,0,0.12);border-radius:980px;font-size:13px;font-family:inherit;outline:none;color:#1d1d1f;}',
      '.ap-input input:focus{border-color:#FF6B00;box-shadow:0 0 0 3px rgba(255,107,0,0.1);}',
      '.ap-input button{width:38px;height:38px;border-radius:50%;background:#FF6B00;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
      '.ap-input button:disabled{background:#ccc;cursor:not-allowed;}',
      '.ap-input button svg{width:18px;height:18px;fill:#fff;}',
      '.ap-welcome{text-align:center;padding:20px 16px;color:#86868b;font-size:12px;line-height:1.6;}',
      '.ap-welcome strong{color:#1d1d1f;font-size:14px;display:block;margin-bottom:6px;}',
      '.ap-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px;}',
      '.ap-chip{font-size:11px;padding:6px 12px;border-radius:980px;border:1px solid rgba(0,0,0,0.1);background:#fff;cursor:pointer;color:#3a3a3c;transition:all 0.15s;}',
      '.ap-chip:hover{border-color:#FF6B00;color:#FF6B00;background:rgba(255,107,0,0.04);}',
      '@media(max-width:900px){#arthur-panel{width:100%;right:-100%;}#arthur-fab{bottom:16px;right:16px;width:48px;height:48px;}#arthur-fab svg{width:22px;height:22px;}}',
    ].join('\n');
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'arthur-fab';
    fab.title = 'Ask Arthur — HGV Technical Assistant';
    fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>';
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'arthur-panel';
    panel.innerHTML = [
      '<div class="ap-hd">',
        '<div class="ap-avatar">🔧</div>',
        '<div><div class="ap-name">Arthur</div><div class="ap-sub">HGV Technical Assistant</div></div>',
        '<div class="ap-badge">HGVDesk</div>',
        '<button class="ap-close" id="arthur-close">&times;</button>',
      '</div>',
      '<div class="ap-msgs" id="arthur-msgs">',
        '<div class="ap-welcome">',
          '<strong>Ask Arthur anything</strong>',
          '50 years of HGV workshop experience at your fingertips. DVSA standards, repair procedures, torque settings, diagnostics.',
          '<div class="ap-chips" id="arthur-chips">',
            '<span class="ap-chip" data-q="What are the DVSA brake efficiency minimums?">Brake minimums</span>',
            '<span class="ap-chip" data-q="How do I check wheel bearing preload?">Bearing preload</span>',
            '<span class="ap-chip" data-q="What are the tyre tread depth requirements for HGV?">Tyre limits</span>',
            '<span class="ap-chip" data-q="How do I check fifth wheel condition?">Fifth wheel</span>',
          '</div>',
        '</div>',
      '</div>',
      '<div class="ap-input">',
        '<input type="text" id="arthur-in" placeholder="Ask Arthur anything about HGV maintenance...">',
        '<button id="arthur-send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>',
      '</div>',
    ].join('');
    document.body.appendChild(panel);

    fab.addEventListener('click', function() { toggle(); });
    document.getElementById('arthur-close').addEventListener('click', function() { toggle(false); });
    document.getElementById('arthur-send').addEventListener('click', send);
    document.getElementById('arthur-in').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    document.getElementById('arthur-chips').addEventListener('click', function(e) {
      const chip = e.target.closest('.ap-chip');
      if (chip && chip.dataset.q) {
        document.getElementById('arthur-in').value = chip.dataset.q;
        send();
      }
    });
  }

  function toggle(forceState) {
    isOpen = forceState !== undefined ? forceState : !isOpen;
    document.getElementById('arthur-panel').classList.toggle('open', isOpen);
    if (isOpen) document.getElementById('arthur-in').focus();
  }

  function addMsg(role, text) {
    const msgs = document.getElementById('arthur-msgs');
    const welcome = msgs.querySelector('.ap-welcome');
    if (welcome) welcome.remove();
    const div = document.createElement('div');
    div.className = 'ap-msg ' + (role === 'user' ? 'user' : 'bot');
    div.innerHTML = role === 'user' ? esc(text) : formatMsg(text);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function showTyping() {
    const msgs = document.getElementById('arthur-msgs');
    const div = document.createElement('div');
    div.className = 'ap-typing';
    div.id = 'arthur-typing';
    div.textContent = 'Arthur is thinking...';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function hideTyping() {
    const t = document.getElementById('arthur-typing');
    if (t) t.remove();
  }

  function send() {
    if (isLoading) return;
    const input = document.getElementById('arthur-in');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg('user', text);
    history.push({ role: 'user', content: text });
    isLoading = true;
    document.getElementById('arthur-send').disabled = true;
    showTyping();

    const payload = { message: text, history: history.slice(0, -1), context: getContext() };
    fetch('/api/ai/technical-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
      body: JSON.stringify(payload)
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      hideTyping();
      const data = d && (d.data || d);
      const reply = (data && data.reply) || 'Sorry, I couldn\'t process that. Try again.';
      addMsg('bot', reply);
      history.push({ role: 'assistant', content: reply });
    })
    .catch(function() {
      hideTyping();
      addMsg('bot', 'Connection error — check your network and try again.');
    })
    .finally(function() {
      isLoading = false;
      document.getElementById('arthur-send').disabled = false;
      document.getElementById('arthur-in').focus();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
