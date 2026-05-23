(function () {
  'use strict';
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (!tabs[0]?.url) { dot.className = 'status-dot red'; text.textContent = 'No active tab'; return; }
    const url = tabs[0].url;
    const isSearch = url.includes('google.') || url.includes('bing.com') || url.includes('duckduckgo.com');
    if (isSearch) { dot.className = 'status-dot green'; text.textContent = 'Active on this page'; }
    else { dot.className = 'status-dot red'; text.textContent = 'Not a search page'; }
  });
})();