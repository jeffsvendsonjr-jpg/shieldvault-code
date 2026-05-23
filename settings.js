(function() {
  'use strict';
  const SETTINGS_KEY = 'userply_settings';
  const defaults = { enabled: true, pillPosition: 'below', showNoArchive: true, disabledSites: [] };
  function load() { try { const raw = localStorage.getItem(SETTINGS_KEY); return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults }; } catch { return { ...defaults }; } }
  function save(settings) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); showSaved(); }
  function showSaved() { const msg = document.getElementById('saved-msg'); msg.classList.add('show'); setTimeout(function() { msg.classList.remove('show'); }, 1500); }
  function renderDisabledList(settings) {
    var list = document.getElementById('disabled-list');
    list.innerHTML = '';
    settings.disabledSites.forEach(function(site, i) {
      var li = document.createElement('li'); li.textContent = site;
      var btn = document.createElement('button'); btn.textContent = '\u00d7'; btn.setAttribute('aria-label', 'Remove ' + site);
      btn.addEventListener('click', function() { settings.disabledSites.splice(i, 1); save(settings); renderDisabledList(settings); });
      li.appendChild(btn); list.appendChild(li);
    });
  }
  var settings = load();
  document.getElementById('toggle-enabled').checked = settings.enabled;
  document.getElementById('pill-position').value = settings.pillPosition;
  document.getElementById('toggle-noarchive').checked = settings.showNoArchive;
  renderDisabledList(settings);
  document.getElementById('toggle-enabled').addEventListener('change', function(e) { settings.enabled = e.target.checked; save(settings); });
  document.getElementById('pill-position').addEventListener('change', function(e) { settings.pillPosition = e.target.value; save(settings); });
  document.getElementById('toggle-noarchive').addEventListener('change', function(e) { settings.showNoArchive = e.target.checked; save(settings); });
  document.getElementById('add-site-btn').addEventListener('click', function() {
    var input = document.getElementById('new-site');
    var site = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (site && !settings.disabledSites.includes(site)) { settings.disabledSites.push(site); save(settings); renderDisabledList(settings); input.value = ''; }
  });
  document.getElementById('new-site').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('add-site-btn').click(); });
  document.getElementById('clear-cache').addEventListener('click', function() { localStorage.removeItem('userply_cache'); showSaved(); });
})();