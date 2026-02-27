// inject.js — injected by mitmproxy into survey.hypergryph.com HTML pages
// {{DEBUG_NO_SUBMIT}} is substituted at intercept time.
(function () {
  'use strict';

  const DEBUG_NO_SUBMIT = {{DEBUG_NO_SUBMIT}};
  const ADVANCE_TEXTS = DEBUG_NO_SUBMIT ? ['下一页'] : ['下一页', '提交'];
  const SKIP_BUTTON_TEXTS = ['下一页', '提交', '上一页'];
  var dialogDismissed = false;

  // ─── On-page log panel ──────────────────────────────────────────────────

  var _logEl = null;
  function ensureLogPanel() {
    if (_logEl && document.body.contains(_logEl)) return;
    _logEl = document.createElement('pre');
    _logEl.id = 'zmd-log';
    _logEl.style.cssText = 'position:fixed;bottom:0;left:0;width:100%;max-height:40vh;'
      + 'overflow-y:auto;margin:0;padding:6px 8px;font:11px/1.4 monospace;'
      + 'background:rgba(0,0,0,.82);color:#0f0;z-index:2147483647;'
      + 'pointer-events:auto;user-select:text;white-space:pre-wrap;word-break:break-all;';
    document.body.appendChild(_logEl);
  }

  function L(msg) {
    console.log('[zmd]', msg);
    try {
      if (!document.body) return;
      ensureLogPanel();
      _logEl.textContent += msg + '\n';
      _logEl.scrollTop = _logEl.scrollHeight;
    } catch(e) {}
  }

  // ─── Badge ──────────────────────────────────────────────────────────────

  function ensureBadge() {
    if (document.getElementById('zmd-badge')) return;
    if (!document.body) return;
    var b = document.createElement('div');
    b.id = 'zmd-badge';
    b.textContent = '✅ 已注入' + (DEBUG_NO_SUBMIT ? ' ⚠调试' : '');
    b.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;'
      + 'padding:6px 14px;border-radius:6px;font:bold 14px system-ui,sans-serif;'
      + 'color:#fff;background:' + (DEBUG_NO_SUBMIT ? '#d97706' : '#16a34a')
      + ';box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none;';
    document.body.appendChild(b);
  }

  if (document.body) ensureBadge();
  else document.addEventListener('DOMContentLoaded', ensureBadge);
  var badgeGuard = new MutationObserver(ensureBadge);
  function _startBadgeGuard() {
    if (document.body) badgeGuard.observe(document.body, { childList: true, subtree: false });
  }
  if (document.body) _startBadgeGuard();
  else document.addEventListener('DOMContentLoaded', _startBadgeGuard);

  // ─── Utilities ────────────────────────────────────────────────────────────

  function findAdvanceButton() {
    return Array.from(document.querySelectorAll('button'))
      .find(function (b) { return ADVANCE_TEXTS.includes(b.textContent.trim()); });
  }

  function sleep(ms) {
    return new Promise(function (r) { return setTimeout(r, ms); });
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

  // ─── Inline answer actions (no server round-trip needed) ─────────────────

  function clickAgreement() {
    L('action: agreement');
    var input = document.querySelector('input[type="checkbox"]');
    if (input) {
      var label = input.closest('label');
      try {
        if (label) label.click();
        else if (!input.checked) input.click();
      } catch (e) { L('agreement click failed: ' + e); }
      try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    }
    setTimeout(function () { var b = findAdvanceButton(); if (b) b.click(); }, 100);
  }

  function clickOptionGroups() {
    var groups = getOptionGroups();
    L('action: option_groups, ' + groups.length + ' groups');
    groups.forEach(function (els) {
      var idx = Math.max(0, els.length - 2);
      L('  click [' + idx + '/' + els.length + ']: ' + els[idx].textContent.trim().slice(0, 30));
      els[idx].click();
    });
    setTimeout(function () { var b = findAdvanceButton(); if (b) b.click(); }, 100);
  }

  // ─── Fallback ─────────────────────────────────────────────────────────────

  function hasUnansweredError() {
    return document.body.textContent.includes('您尚未答完此题');
  }

  async function handleFallback(retries) {
    retries = retries || 10;
    for (var attempt = 0; attempt < retries; attempt++) {
      L('fallback ' + (attempt + 1) + '/' + retries);
      var groups = getOptionGroups();
      if (groups.length > 0) {
        groups.forEach(function (els) {
          var n = 1 + Math.floor(Math.random() * Math.min(3, els.length));
          els.slice().sort(function () { return Math.random() - 0.5; }).slice(0, n)
            .forEach(function (e) { e.click(); });
        });
      } else {
        var btns = Array.from(document.querySelectorAll('button')).filter(function (b) {
          return !SKIP_BUTTON_TEXTS.includes(b.textContent.trim());
        });
        btns.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 3)
          .forEach(function (b) { b.click(); });
      }
      await sleep(200);
      var adv = Array.from(document.querySelectorAll('button'))
        .find(function (b) { return b.textContent.trim() === '下一页'; });
      if (adv) adv.click();
      await sleep(500);
      if (!hasUnansweredError()) return;
    }
    lastKey = '';
    L('fallback exhausted');
  }

  // ─── Navigation guard ────────────────────────────────────────────────────

  var lastKey = '';
  var debounceTimer = null;
  var processing = false;

  function pageKey() {
    return location.href + '|' + document.body.children.length + '|' + (document.body.innerText || '').length;
  }

  async function processPage() {
    if (processing) return;
    var key = pageKey();
    if (key === lastKey) return;
    lastKey = key;
    processing = true;
    try {
      // Log DOM summary
      var btns = document.querySelectorAll('button').length;
      var cbs = document.querySelectorAll('input[type="checkbox"]').length;
      var bg = getButtonGroups().length;
      var dg = getDivOptionContainers().length;
      L('page: ' + btns + ' btns, ' + cbs + ' cb, ' + bg + ' btnGrp, ' + dg + ' divGrp');

      var pageType = detectPageType();
      if (!pageType) { L('⚠ unknown page type'); return; }
      L('→ ' + pageType);

      if (pageType === 'agreement') clickAgreement();
      else if (pageType === 'option_groups') clickOptionGroups();

      await sleep(200);
      if (hasUnansweredError()) await handleFallback();
    } finally {
      processing = false;
      setTimeout(function () { processPage(); }, 300);
    }
  }

  function onMutation() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { processPage(); }, 10);
  }

  // ─── Dialog dismissal ─────────────────────────────────────────────────────

  function dismissResumeDialog() {
    if (dialogDismissed || !document.body) return false;
    if (!document.body.textContent.includes('您之前已经回答了部分题目，是否继续上次回答')) return false;
    var allBtns = Array.from(document.querySelectorAll('button, [role="button"], a'));
    var cancel = allBtns.find(function (b) { return b.textContent.trim().includes('取消'); });
    if (cancel) { cancel.click(); dialogDismissed = true; lastKey = ''; L('dismissed dialog (取消)'); return true; }
    var next = allBtns.find(function (b) { return b.textContent.trim().includes('下一页'); });
    if (next) { next.click(); dialogDismissed = true; lastKey = ''; L('dismissed dialog (下一页)'); return true; }
    L('⚠ dialog detected but no button found');
    return false;
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────

  async function bootstrap() {
    L('bootstrap: waiting 1s...');
    await sleep(1000);

    var dObs = new MutationObserver(function () { if (!dialogDismissed) dismissResumeDialog(); });
    dObs.observe(document.body, { childList: true, subtree: true });

    if (dismissResumeDialog()) { L('dialog dismissed, waiting 1s...'); await sleep(1000); }

    processPage();
    new MutationObserver(onMutation).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
  else bootstrap();
})();
