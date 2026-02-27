// inject.js — injected by mitmproxy into survey.hypergryph.com HTML pages
// {{DEBUG_NO_SUBMIT}} is substituted at intercept time.
(function () {
  'use strict';

  const DEBUG_NO_SUBMIT = {{DEBUG_NO_SUBMIT}};
  const ADVANCE_TEXTS = DEBUG_NO_SUBMIT ? ['下一页'] : ['下一页', '提交'];
  const SKIP_BUTTON_TEXTS = ['下一页', '提交', '上一页'];
  var dialogDismissed = false;

  // ─── Injected badge ───────────────────────────────────────────────────────

  function ensureBadge() {
    if (document.getElementById('zmd-badge')) return;
    if (!document.body) return;
    var badge = document.createElement('div');
    badge.id = 'zmd-badge';
    badge.textContent = '✅ 已被注入' + (DEBUG_NO_SUBMIT ? ' · ⚠️ 调试模式（不提交）' : '');
    badge.style.cssText = [
      'position:fixed',
      'top:12px',
      'right:12px',
      'z-index:2147483647',
      'padding:10px 20px',
      'border-radius:8px',
      'font-size:16px',
      'font-weight:bold',
      'font-family:system-ui,sans-serif',
      'color:#fff',
      'background:' + (DEBUG_NO_SUBMIT ? '#d97706' : '#16a34a'),
      'box-shadow:0 4px 12px rgba(0,0,0,.45)',
      'pointer-events:none',
      'user-select:none',
    ].join(';');
    document.body.appendChild(badge);
  }

  // Insert badge as soon as body is available
  if (document.body) {
    ensureBadge();
  } else {
    document.addEventListener('DOMContentLoaded', ensureBadge);
  }

  // Re-insert badge if SPA re-renders wipe it
  var badgeGuard = new MutationObserver(ensureBadge);
  var _startBadgeGuard = function () {
    if (document.body) badgeGuard.observe(document.body, { childList: true, subtree: false });
  };
  if (document.body) { _startBadgeGuard(); }
  else { document.addEventListener('DOMContentLoaded', _startBadgeGuard); }

  // ─── Utilities ────────────────────────────────────────────────────────────

  function findAdvanceButton() {
    return Array.from(document.querySelectorAll('button'))
      .find(function (b) { return ADVANCE_TEXTS.includes(b.textContent.trim()); });
  }

  function sleep(ms) {
    return new Promise(function (r) { return setTimeout(r, ms); });
  }

  // ─── HTTP fetch transport ─────────────────────────────────────────────────

  const _QUERY_URL = 'https://survey.hypergryph.com/__zmd_query__';
  const _LOG_URL   = 'https://survey.hypergryph.com/__zmd_log__';

  async function sendQuery(payload) {
    console.log('[zmd] sendQuery:', payload && payload.page_type);
    try {
      var resp = await fetch(_QUERY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var msg = await resp.json();
      console.log('[zmd] sendQuery: recv', msg && msg.type);
      return msg;
    } catch (e) {
      console.error('[zmd] sendQuery fetch error', e);
      return null;
    }
  }

  function wsSendLog(message) {
    fetch(_LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'log', message: message }),
    }).catch(function () {});
  }

  // ─── DOM structure logging ──────────────────────────────────────────────

  function parentPath(el, depth) {
    depth = depth || 3;
    var parts = [];
    var cur = el;
    for (var i = 0; i < depth && cur; i++) {
      parts.unshift(cur.tagName + (cur.className ? '.' + String(cur.className).split(' ')[0] : ''));
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function logDomStructure() {
    var lines = ['=== [zmd] DOM structure dump ==='];

    // All buttons
    var allBtns = Array.from(document.querySelectorAll('button'));
    lines.push('Buttons (' + allBtns.length + '):');
    allBtns.forEach(function (b, i) {
      lines.push('  btn[' + i + '] text=' + JSON.stringify(b.textContent.trim().slice(0, 40)) + ' path=' + parentPath(b, 4));
    });

    // Checkbox
    var cb = document.querySelector('input[type="checkbox"]');
    if (cb) {
      lines.push('Checkbox: checked=' + cb.checked + ' path=' + parentPath(cb, 4));
    }

    // Button groups
    var btnGroups = getButtonGroups();
    lines.push('Button groups (' + btnGroups.length + '):');
    btnGroups.forEach(function (btns, i) {
      lines.push('  BtnGroup[' + i + '] (' + btns.length + ' btns) texts=['
        + btns.map(function (b) { return JSON.stringify(b.textContent.trim().slice(0, 20)); }).join(', ') + ']');
    });

    // Div option containers
    var divGroups = getDivOptionContainers();
    lines.push('Div option containers (' + divGroups.length + '):');
    divGroups.forEach(function (kids, i) {
      lines.push('  DivGroup[' + i + '] (' + kids.length + ' children) texts=['
        + kids.map(function (k) { return JSON.stringify(k.textContent.trim().slice(0, 20)); }).join(', ') + ']');
    });

    var dump = lines.join('\n');
    console.log(dump);
    wsSendLog(dump);
  }

  function detectAgreement() {
    // Only match the actual agreement page: an unchecked checkbox whose
    // label (or nearest container) contains the exact agreement text.
    var cb = document.querySelector('input[type="checkbox"]');
    if (!cb) return false;
    if (cb.checked) return false;  // already accepted → not agreement page
    var label = cb.closest('label');
    if (label && label.textContent.includes('我已阅读，并同意以上内容')) return true;
    // Slightly broader: check the checkbox's parent chain (up to 3 levels)
    var el = cb.parentElement;
    for (var i = 0; i < 3 && el; i++) {
      if (el.textContent && el.textContent.includes('我已阅读，并同意以上内容')) return true;
      el = el.parentElement;
    }
    return false;
  }

  // ─── Option-group detection ──────────────────────────────────────────────
  // Two-phase detection:
  //   Phase 1 — button groups: group <button> elements by parentElement,
  //             keep groups with ≥2 buttons (leaf filter works because
  //             buttons never nest inside other buttons).
  //   Phase 2 — div option containers (only if no button groups found):
  //             find a container div whose direct children are all divs
  //             with a consistent sub-structure (≥2 child divs each).
  //             This matches the icon+text pattern and rating grids.

  function getButtonGroups() {
    var allBtns = Array.from(document.querySelectorAll('button')).filter(function (b) {
      var text = b.textContent.trim();
      return text && !SKIP_BUTTON_TEXTS.includes(text);
    });
    var map = new Map();
    allBtns.forEach(function (b) {
      var p = b.parentElement;
      if (!p) return;
      if (!map.has(p)) map.set(p, []);
      map.get(p).push(b);
    });
    var groups = [];
    map.forEach(function (btns) {
      if (btns.length >= 2) groups.push(btns);
    });
    return groups;
  }

  function getDivOptionContainers() {
    // A container is a div with 3–10 direct child divs, where each child
    // has ≥2 child divs itself (icon+text, or similar repeated structure).
    var allDivs = Array.from(document.querySelectorAll('div'));
    var containers = [];
    for (var i = 0; i < allDivs.length; i++) {
      var el = allDivs[i];
      var kids = Array.from(el.children);
      if (kids.length < 3 || kids.length > 10) continue;
      var allDivKids = kids.every(function (k) {
        return k.tagName === 'DIV' && k.children.length >= 2;
      });
      if (allDivKids) containers.push(kids);
    }
    return containers;
  }

  function getOptionGroups() {
    var btnGroups = getButtonGroups();
    if (btnGroups.length > 0) return btnGroups;
    return getDivOptionContainers();
  }

  function detectPageType() {
    if (detectAgreement()) return 'agreement';
    if (getOptionGroups().length > 0) return 'option_groups';
    return null;
  }

  function buildGroups(pageType) {
    if (pageType === 'agreement') return [];
    if (pageType === 'option_groups') {
      return getOptionGroups().map(function (els, i) {
        return {
          index: i,
          option_texts: els.map(function (e) { return e.textContent.trim(); }),
        };
      });
    }
    return [];
  }

  // ─── Fallback: 您尚未答完此题 ──────────────────────────────────────────────

  function hasUnansweredError() {
    return document.body.textContent.includes('您尚未答完此题');
  }

  async function handleFallback(retries) {
    retries = retries === undefined ? 10 : retries;
    for (var attempt = 0; attempt < retries; attempt++) {
      console.warn('[zmd] fallback attempt ' + (attempt + 1) + '/' + retries);
      wsSendLog('[zmd] fallback attempt ' + (attempt + 1) + '/' + retries);

      // For every detected option group, randomly pick 1–3 options and click them.
      var groups = getOptionGroups();
      if (groups.length > 0) {
        groups.forEach(function (els) {
          var count = 1 + Math.floor(Math.random() * Math.min(3, els.length));
          var shuffled = els.slice().sort(function () { return Math.random() - 0.5; });
          shuffled.slice(0, count).forEach(function (e) {
            console.log('[zmd] fallback: clicking:', e.textContent.trim().slice(0, 30));
            e.click();
          });
        });
      } else {
        // No text-based groups found — try every non-nav button at random.
        var allBtns = Array.from(document.querySelectorAll('button')).filter(function (b) {
          return !SKIP_BUTTON_TEXTS.includes(b.textContent.trim());
        });
        var count = Math.min(3, allBtns.length);
        allBtns.slice().sort(function () { return Math.random() - 0.5; }).slice(0, count)
          .forEach(function (b) {
            console.log('[zmd] fallback: clicking button:', b.textContent.trim());
            b.click();
          });
      }

      // Give the DOM time to register the clicks before advancing.
      await sleep(200);

      // In fallback, ONLY click 下一页 — NEVER 提交.
      var advBtn = Array.from(document.querySelectorAll('button'))
        .find(function (b) { return b.textContent.trim() === '下一页'; });
      if (advBtn) {
        console.log('[zmd] fallback: clicking 下一页');
        advBtn.click();
      }

      await sleep(500);
      if (!hasUnansweredError()) return;
    }
    // Reset lastKey so the page can be retried on next DOM mutation.
    lastKey = '';
    wsSendLog('fallback exhausted after ' + retries + ' retries');
    console.error('[zmd] fallback exhausted');
  }

  // ─── Navigation guard ────────────────────────────────────────────────────

  var lastKey = '';
  var debounceTimer = null;
  var processing = false;

  function pageKey() {
    // Include innerText length so SPA navigations that keep the same URL
    // and body.children.length but change visible content are detected.
    return location.href + '|' + document.body.children.length + '|' + (document.body.innerText || '').length;
  }

  async function processPage() {
    if (processing) return;
    var key = pageKey();
    if (key === lastKey) return;
    lastKey = key;

    processing = true;
    try {
      // Dump DOM structure for debugging
      logDomStructure();

      var pageType = detectPageType();
      if (!pageType) {
        console.log('[zmd] no recognisable page type');
        wsSendLog('[zmd] no recognisable page type — check DOM dump above');
        return;
      }
      console.log('[zmd] detected page type:', pageType);
      wsSendLog('[zmd] detected page type: ' + pageType);

      var payload = {
        type: 'query',
        page_type: pageType,
        groups: buildGroups(pageType),
        outer_html: document.body.outerHTML
      };

      var resp = await sendQuery(payload);
      if (!resp || !resp.code) {
        console.error('[zmd] empty response from server');
        return;
      }

      try {
        console.log('[zmd] evaling code (len=' + (resp.code && resp.code.length) + ')');
        // Show first 200 chars for quick debugging
        console.log('[zmd] code preview:', (resp.code || '').slice(0, 200));
        eval(resp.code);
      } catch (e) { console.error('[zmd] eval error', e); }

      // Watch for unanswered error within 200 ms
      await sleep(200);
      if (hasUnansweredError()) {
        await handleFallback();
      }
    } finally {
      processing = false;
      // Re-check after a short delay: mutations that fired while we were
      // processing (e.g. SPA navigation triggered by the advance button)
      // were ignored because processing was true.  This ensures the new
      // page gets picked up even if no further DOM mutations occur.
      setTimeout(function () { processPage(); }, 300);
    }
  }

  function onMutation() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { processPage(); }, 10);
  }

  // ─── Dialog dismissal: 您之前已经回答了部分题目 ────────────────────────────

  function dismissResumeDialog() {
    if (dialogDismissed) return false;
    if (!document.body) return false;
    if (!document.body.textContent.includes('您之前已经回答了部分题目，是否继续上次回答')) return false;

    // Search the whole document for any button/role=button whose text contains 取消
    var allBtns = Array.from(document.querySelectorAll('button, [role="button"], a'));
    console.log('[zmd] resume-dialog: found buttons:', allBtns.map(function(b){ return JSON.stringify(b.textContent.trim()); }).join(', '));
    wsSendLog('[zmd] resume-dialog: found ' + allBtns.length + ' buttons');
    var cancelBtn = allBtns.find(function (b) {
      var t = b.textContent.trim();
      return t === '取消' || t.includes('取消');
    });
    if (cancelBtn) {
      cancelBtn.click();
      dialogDismissed = true;
      lastKey = '';  // reset so next page gets processed
      console.log('[zmd] dismissed resume-dialog (取消)');
      wsSendLog('[zmd] dismissed resume-dialog (取消)');
      return true;
    }

    // Fallback: no 取消 found — click 下一页 to proceed through the dialog
    var nextBtn = allBtns.find(function (b) {
      var t = b.textContent.trim();
      return t === '下一页' || t.includes('下一页');
    });
    if (nextBtn) {
      nextBtn.click();
      dialogDismissed = true;
      lastKey = '';  // reset so next page gets processed
      console.log('[zmd] dismissed resume-dialog (下一页 fallback)');
      wsSendLog('[zmd] dismissed resume-dialog (下一页 fallback)');
      return true;
    }

    console.warn('[zmd] resume-dialog detected but no dismiss button found');
    return false;
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────

  async function bootstrap() {
    // Delay startup slightly to allow SPA rendering / CSS to stabilise.
    console.log('[zmd] bootstrap: delaying 1s before processing');
    await sleep(1000);

    // Watch for resume-dialog appearance (only fires until dialog is dismissed)
    var dialogObserver = new MutationObserver(function () {
      if (!dialogDismissed) dismissResumeDialog();
    });
    dialogObserver.observe(document.body, { childList: true, subtree: true });

    // Initial scan (dialog may already be present)
    if (dismissResumeDialog()) {
      // Dialog was dismissed — wait for SPA to load the new page content
      console.log('[zmd] bootstrap: dialog dismissed, waiting 1s for page to load');
      await sleep(1000);
    }

    // Initial page processing
    processPage();

    // Watch for SPA navigation
    var observer = new MutationObserver(onMutation);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
