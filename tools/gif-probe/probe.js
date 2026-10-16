// Desktop GIFs probe: a one-off diagnostic for upstream issue #93.
//
// Arm it, then post a comment with YouTube's own Comment button. Instead of
// sending that request, the probe sends it with a GIF in several variants, one
// at a time, and stops at the first one YouTube does not turn down. It reports
// how YouTube answered each, without cookies, auth headers or comment text.
(() => {
  // Real app versions; YouTube may want newer ones, and its answer says so.
  const ANDROID_VERSION = '20.10.38';
  const IOS_VERSION = '20.10.4';
  // Rated G on Tenor; the one from the log in issue #93.
  const DEFAULT_GIF = '8682985440799307027';

  const CREATE_URL = /\/youtubei\/v1\/comment\/create_comment(_reply)?(\?|$)/;
  const SCAN_URL = /\/youtubei\/v1\/(next|browse|comment\/)/;
  const originalFetch = window.fetch;
  const leads = new Map();
  let armed = false;
  let running = false;
  let report = null;
  let ui = null;

  const VARIANTS = [
    {
      name: 'WEB (what Desktop GIFs sends)',
      client: {},
    },
    {
      name: 'MWEB (mobile website)',
      client: { clientName: 'MWEB', platform: 'MOBILE' },
      clientId: '2',
    },
    {
      name: 'ANDROID',
      client: { clientName: 'ANDROID', clientVersion: ANDROID_VERSION, osName: 'Android', osVersion: '14', androidSdkVersion: 34, platform: 'MOBILE' },
      drop: ['browserName', 'browserVersion'],
      clientId: '3',
    },
    {
      name: 'ANDROID + app User-Agent',
      client: { clientName: 'ANDROID', clientVersion: ANDROID_VERSION, osName: 'Android', osVersion: '14', androidSdkVersion: 34, platform: 'MOBILE' },
      drop: ['browserName', 'browserVersion'],
      clientId: '3',
      ua: `com.google.android.youtube/${ANDROID_VERSION} (Linux; U; Android 14) gzip`,
    },
    {
      name: 'IOS + app User-Agent',
      client: { clientName: 'IOS', clientVersion: IOS_VERSION, deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.1.0.22B83', platform: 'MOBILE' },
      drop: ['browserName', 'browserVersion'],
      clientId: '5',
      ua: `com.google.ios.youtube/${IOS_VERSION} (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)`,
    },
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Asks the extension's service worker to set (or clear, with null) the
  // User-Agent of comment-create requests.
  let uaSeq = 0;
  function setUserAgent(ua) {
    const id = ++uaSeq;
    return new Promise((resolve) => {
      const done = (e) => {
        if (e.source !== window || !e.data || e.data.gifProbe !== 'ua-done' || e.data.id !== id) return;
        window.removeEventListener('message', done);
        resolve(e.data);
      };
      window.addEventListener('message', done);
      window.postMessage({ gifProbe: 'ua', id, ua }, location.origin);
      setTimeout(() => resolve({ ok: false, error: 'no answer from the extension' }), 3000);
    });
  }

  async function readBody(input, init) {
    const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : {}));
    let buf;
    if (init && init.body != null) buf = await new Response(init.body).arrayBuffer();
    else if (input instanceof Request) buf = await input.clone().arrayBuffer();
    else return null;
    const text = headers.get('content-encoding') === 'gzip'
      ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      : new TextDecoder().decode(buf);
    headers.delete('content-encoding');
    return { headers, body: JSON.parse(text) };
  }

  function textOf(v) {
    if (typeof v === 'string') return v;
    if (!v || typeof v !== 'object') return '';
    if (typeof v.simpleText === 'string') return v.simpleText;
    if (Array.isArray(v.runs)) return v.runs.map((r) => r.text || '').join('');
    return '';
  }

  // Every showErrorAction's text anywhere in a response.
  function errorTexts(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (node.showErrorAction) {
      const m = node.showErrorAction.errorMessage;
      out.push(textOf(m && m.messageRenderer && m.messageRenderer.text) || textOf(m) || '(no text)');
    }
    for (const v of Object.values(node)) errorTexts(v, out);
    return out;
  }

  // Paths in YouTube's JSON whose key or text mentions GIFs or Tenor: a hint
  // of how YouTube's own clients attach one.
  function scan(node, path, depth = 0) {
    if (leads.size >= 60 || depth > 40 || !node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const p = `${path}.${k}`;
      if (/tenor|gif/i.test(k)) leads.set(p.replace(/\.\d+(?=\.|$)/g, '[]'), typeof v === 'object' ? `{${Object.keys(v || {}).join(',')}}` : String(v).slice(0, 80));
      else if (typeof v === 'string' && /tenor|\bgifs?\b/i.test(v) && v.length < 300) leads.set(p.replace(/\.\d+(?=\.|$)/g, '[]'), v.slice(0, 80));
      if (typeof v === 'object') scan(v, p, depth + 1);
    }
  }

  function variantRequest(base, headers, v) {
    const body = JSON.parse(JSON.stringify(base));
    const client = body.context && body.context.client;
    if (client) {
      for (const k of v.drop || []) delete client[k];
      Object.assign(client, v.client);
    }
    const h = new Headers(headers);
    if (v.clientId) {
      h.set('x-youtube-client-name', v.clientId);
      if (client) h.set('x-youtube-client-version', client.clientVersion);
    }
    return { body: JSON.stringify(body), headers: h };
  }

  async function probe(url, input, init) {
    running = true;
    try {
      return await runProbe(url, input, init);
    } catch (e) {
      // Nothing was sent by the probe itself: let the page's request through.
      report = { probe: '0.0.1', failed: String(e) };
      return originalFetch.call(window, input, init);
    } finally {
      armed = false;
      running = false;
      render(report && report.failed ? 'The probe failed; the comment was sent as it was.' : 'Done. Copy the report into the chat.');
    }
  }

  async function runProbe(url, input, init) {
    const gif = (ui && ui.gif.value.trim()) || DEFAULT_GIF;
    const parsed = await readBody(input, init);
    const base = parsed.body;
    const client = (base.context && base.context.client) || {};
    report = {
      probe: '0.0.1',
      when: new Date().toISOString(),
      endpoint: CREATE_URL.exec(url)[1] ? 'create_comment_reply' : 'create_comment',
      gif,
      hasText: typeof base.commentText === 'string' && base.commentText.trim() !== '',
      requestFields: Object.keys(base),
      requestHeaders: [...parsed.headers.keys()],
      pageClient: { clientName: client.clientName, clientVersion: client.clientVersion, platform: client.platform, gl: client.gl, hl: client.hl },
      tries: [],
    };
    base.tenorId = gif;
    render('Running…');

    let last = null;
    for (const v of VARIANTS) {
      const req = variantRequest(base, parsed.headers, v);
      const t = { variant: v.name };
      if (v.ua) {
        const r = await setUserAgent(v.ua);
        if (!r.ok) t.uaError = r.error;
      }
      try {
        const options = { ...init, body: req.body, headers: req.headers };
        last = await originalFetch.call(window, input instanceof Request ? new Request(input, options) : input, options);
        t.http = last.status;
        let json = null;
        try { json = await last.clone().json(); } catch (e) { t.unreadable = true; }
        if (json && json.error) t.error = json.error;
        if (json && json.actionResult) t.actionStatus = json.actionResult.status;
        const errs = json ? errorTexts(json) : [];
        if (errs.length) t.errorActions = errs;
        if (json) t.responseFields = Object.keys(json);
      } catch (e) {
        t.fetchError = String(e);
      }
      if (v.ua) await setUserAgent(null);
      report.tries.push(t);
      render('Running…');
      // Go on only when YouTube clearly posted nothing.
      const refused = (t.http >= 400 && t.http < 500) || (t.http === 200 && t.actionStatus !== 'STATUS_SUCCEEDED' && t.errorActions);
      if (!refused) {
        report.stoppedAt = v.name;
        report.outcome = t.actionStatus === 'STATUS_SUCCEEDED' && !t.errorActions ? 'POSTED with this variant: check the comment is up and stays up' : 'unclear: check the comments before trying again';
        break;
      }
      await sleep(1500);
    }
    if (!report.outcome) report.outcome = 'every variant refused; nothing was posted';
    return last;
  }

  window.fetch = function (input, init) {
    let url = '';
    try { url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input); } catch (e) { /* ignore */ }
    if (armed && !running && CREATE_URL.test(url)) return probe(url, input, init);
    const res = originalFetch.apply(this, arguments);
    if (SCAN_URL.test(url)) {
      res.then((r) => r.clone().json()).then((j) => { scan(j, url.match(/v1\/([\w/]+)/)[1]); render(); }).catch(() => {});
    }
    return res;
  };

  function fullReport() {
    return JSON.stringify({ ...(report || { note: 'no probe run yet' }), gifLeads: Object.fromEntries(leads) }, null, 2);
  }

  function render(status) {
    if (!ui) return;
    if (status) ui.status.textContent = status;
    ui.arm.textContent = armed ? 'Armed: next Comment click is probed (click to disarm)' : 'Arm';
    ui.arm.style.background = armed ? '#c00' : '#333';
    ui.out.value = fullReport();
  }

  function build() {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;width:380px;background:#111;color:#eee;font:12px/1.4 monospace;border:1px solid #555;border-radius:8px;padding:8px;box-shadow:0 4px 16px #0008';
    const title = document.createElement('div');
    title.textContent = 'Desktop GIFs probe (#93)';
    title.style.fontWeight = 'bold';
    const gifRow = document.createElement('label');
    gifRow.textContent = 'Tenor ID ';
    const gif = document.createElement('input');
    gif.value = DEFAULT_GIF;
    gif.style.cssText = 'width:200px;background:#222;color:#eee;border:1px solid #555';
    gifRow.append(gif);
    const arm = document.createElement('button');
    arm.style.cssText = 'display:block;width:100%;margin:6px 0;color:#fff;border:0;padding:6px;cursor:pointer';
    arm.onclick = () => { if (!running) { armed = !armed; render(armed ? 'Write a test comment and press YouTube\'s Comment button.' : 'Disarmed.'); } };
    const status = document.createElement('div');
    const out = document.createElement('textarea');
    out.readOnly = true;
    out.style.cssText = 'width:100%;height:160px;background:#000;color:#9f9;font:11px monospace;border:1px solid #444';
    const row = document.createElement('div');
    const copy = document.createElement('button');
    copy.textContent = 'Copy report';
    copy.onclick = () => navigator.clipboard.writeText(fullReport()).then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy report'; }, 1500); });
    const hide = document.createElement('button');
    hide.textContent = 'Hide';
    hide.onclick = () => box.remove();
    row.append(copy, ' ', hide);
    box.append(title, gifRow, arm, status, out, row);
    document.body.append(box);
    ui = { gif, arm, status, out };
    // Whatever YouTube put in the page before the probe saw any request.
    if (window.ytInitialData) scan(window.ytInitialData, 'ytInitialData');
    render('Open a video, click Arm, then post a test comment.');
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
