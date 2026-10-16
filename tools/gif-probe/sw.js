// Sets (or, with ua null, clears) the User-Agent of comment-create requests.
// fetch() cannot change that header itself.
const RULE_ID = 1;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const rule = msg.ua ? [{
    id: RULE_ID,
    priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'user-agent', operation: 'set', value: msg.ua }] },
    condition: { urlFilter: '||www.youtube.com/youtubei/v1/comment/create_comment', resourceTypes: ['xmlhttprequest', 'other'] },
  }] : [];
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID], addRules: rule })
    .then(() => reply({ ok: true }), (e) => reply({ ok: false, error: String(e) }));
  return true;
});

// Never leave a changed User-Agent behind after a reload.
chrome.runtime.onStartup.addListener(() => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] }));
chrome.runtime.onInstalled.addListener(() => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] }));
