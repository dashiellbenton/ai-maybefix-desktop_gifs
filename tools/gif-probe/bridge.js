// Isolated world: passes User-Agent requests from probe.js to the service
// worker, which alone can change that header.
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.gifProbe !== 'ua') return;
  const { id, ua } = e.data;
  chrome.runtime.sendMessage({ ua }).then(
    (r) => window.postMessage({ gifProbe: 'ua-done', id, ok: !!(r && r.ok), error: r && r.error }, location.origin),
    (err) => window.postMessage({ gifProbe: 'ua-done', id, ok: false, error: String(err) }, location.origin),
  );
});
