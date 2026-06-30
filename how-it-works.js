(function () {
  try {
    document.getElementById('manifest-version').textContent = 'v' + chrome.runtime.getManifest().version;
  } catch (_) {}
})();
