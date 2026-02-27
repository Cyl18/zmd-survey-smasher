// inject.js — injected by mitmproxy into survey.hypergryph.com HTML pages
// {{DEBUG_NO_SUBMIT}} is substituted at intercept time.
// NOTE: no async/await — some QtWebEngine builds break on it silently.
// NOTE: Chrome/87 compat — no <pre>, no vh units, all styles !important.
(function () {
  'use strict';

  var DEBUG_NO_SUBMIT = {{DEBUG_NO_SUBMIT}};
  var ADVANCE_TEXTS = DEBUG_NO_SUBMIT ? ['下一页'] : ['下一页', '提交'];
  var SKIP_BUTTON_TEXTS = ['下一页', '提交', '上一页'];
  var dialogDismissed = false;

  // ─── On-page log panel (created synchronously, same as badge) ──────────

  var _logEl = null;
  var _logBuffer = [];   // survives DOM wipes; capped at 200 lines
  var _logVisible = true;

  // Build a style string with !important on every property so game CSS
  // cannot override our overlay elements.
  function _imp(css) {
    return css.replace(/;/g, ' !important;');
  }

  function _initUI() {
    if (!document.body) return;
    // Badge — clickable to toggle log panel
    var badge = document.getElementById('zmd-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'zmd-badge';
      badge.textContent = '\u2705 \u5df2\u6ce8\u5165' + (DEBUG_NO_SUBMIT ? ' \u26a0\u8c03\u8bd5' : '');
      badge.style.cssText = _imp(
        'position:fixed;top:8px;right:8px;z-index:2147483647;'
        + 'padding:6px 14px;border-radius:6px;font-size:14px;font-weight:bold;'
        + 'font-family:system-ui,sans-serif;line-height:1.4;'
        + 'color:#fff;background:' + (DEBUG_NO_SUBMIT ? '#d97706' : '#16a34a')
        + ';box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer;'
        + 'display:block;visibility:visible;opacity:1;'
      );
      badge.addEventListener('click', function () {
        _logVisible = !_logVisible;
        if (_logEl) _logEl.style.setProperty('display', _logVisible ? 'block' : 'none', 'important');
      });
      document.body.appendChild(badge);
    }
    // Log panel — positioned at TOP (below badge) because game UI covers
    // the bottom.  Uses <div> (not <pre>) to dodge game CSS resets.
    // px units only (no vh — broken in some embedded webviews).
    if (!_logEl || !document.body.contains(_logEl)) {
      _logEl = document.createElement('div');
      _logEl.id = 'zmd-log';
      _logEl.style.cssText = _imp(
        'position:fixed;top:40px;right:8px;width:55%;max-height:200px;min-height:32px;'
        + 'overflow-y:auto;overflow-x:hidden;margin:0;padding:6px 8px;'
        + 'box-sizing:border-box;border-radius:6px;'
        + 'font-size:11px;font-family:monospace;line-height:1.3;'
        + 'background:rgba(0,0,0,.82);color:#0f0;z-index:2147483646;'
        + 'pointer-events:auto;user-select:text;'
        + 'white-space:pre-wrap;word-break:break-all;'
        + 'display:' + (_logVisible ? 'block' : 'none') + ';visibility:visible;opacity:1;'
        + 'border:none;text-align:left;float:none;'
        + 'transform:none;clip:auto;'
      );
      if (_logBuffer.length) _logEl.textContent = _logBuffer.join('\n') + '\n';
      document.body.appendChild(_logEl);
      _logEl.scrollTop = 1e9;
    }
  }

  function L(msg) {
    try { console.log('[zmd]', msg); } catch(e) {}
    _logBuffer.push(msg);
    if (_logBuffer.length > 200) _logBuffer.shift();
    try {
      if (!document.body) return;
      _initUI();
      _logEl.textContent += msg + '\n';
      _logEl.scrollTop = 1e9;
    } catch(e) {}
  }

  // Create UI immediately (synchronous — no async dependency)
  if (document.body) { _initUI(); }
  else { document.addEventListener('DOMContentLoaded', _initUI); }
  // Re-create if SPA wipes it
  var _uiGuard = new MutationObserver(_initUI);
  function _startGuard() {
    if (document.body) _uiGuard.observe(document.body, { childList: true, subtree: false });
  }
  if (document.body) _startGuard();
  else document.addEventListener('DOMContentLoaded', _startGuard);

  L('script loaded (Chrome/87 compat)');

  // ─── Utilities ────────────────────────────────────────────────────────────

  function findAdvanceButton() {
    return Array.from(document.querySelectorAll('button'))
      .find(function (b) { return ADVANCE_TEXTS.indexOf(b.textContent.trim()) !== -1; });
  }

  function detectAgreement() {
    // Only match the actual agreement page: an unchecked checkbox whose
    // label (or nearest container) contains the exact agreement text.
    var cb = document.querySelector('input[type="checkbox"]');
    if (!cb) return false;
    if (cb.checked) return false;  // already accepted → not agreement page
    var label = cb.closest('label');
    if (label && label.textContent.indexOf('我已阅读，并同意以上内容') !== -1) return true;
    // Slightly broader: check the checkbox's parent chain (up to 3 levels)
    var el = cb.parentElement;
    for (var i = 0; i < 3 && el; i++) {
      if (el.textContent && el.textContent.indexOf('我已阅读，并同意以上内容') !== -1) return true;
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
      return text && SKIP_BUTTON_TEXTS.indexOf(text) === -1;
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

  // ─── Fallback (pure setTimeout, no async) ──────────────────────────────

  function hasUnansweredError() {
    return document.body.textContent.indexOf('您尚未答完此题') !== -1;
  }

  function handleFallback(attempt, maxRetries, done) {
    attempt = attempt || 0;
    maxRetries = maxRetries || 10;
    if (attempt >= maxRetries) { lastKey = ''; L('fallback exhausted'); done(); return; }
    L('fallback ' + (attempt + 1) + '/' + maxRetries);
    var groups = getOptionGroups();
    if (groups.length > 0) {
      groups.forEach(function (els) {
        var n = 1 + Math.floor(Math.random() * Math.min(3, els.length));
        els.slice().sort(function () { return Math.random() - 0.5; }).slice(0, n)
          .forEach(function (e) { e.click(); });
      });
    } else {
      var btns = Array.from(document.querySelectorAll('button')).filter(function (b) {
        return SKIP_BUTTON_TEXTS.indexOf(b.textContent.trim()) === -1;
      });
      btns.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 3)
        .forEach(function (b) { b.click(); });
    }
    setTimeout(function () {
      var adv = Array.from(document.querySelectorAll('button'))
        .find(function (b) { return b.textContent.trim() === '下一页'; });
      if (adv) adv.click();
      setTimeout(function () {
        if (!hasUnansweredError()) { done(); return; }
        handleFallback(attempt + 1, maxRetries, done);
      }, 500);
    }, 200);
  }

  // ─── Navigation guard (pure setTimeout, no async) ─────────────────────

  var lastKey = '';
  var debounceTimer = null;
  var processing = false;

  function pageKey() {
    return location.href + '|' + document.body.children.length + '|' + (document.body.innerText || '').length;
  }

  function processPage() {
    if (processing) return;
    var key = pageKey();
    if (key === lastKey) return;
    lastKey = key;
    processing = true;

    try {
      var nBtn = document.querySelectorAll('button').length;
      var nCb = document.querySelectorAll('input[type="checkbox"]').length;
      var nBg = getButtonGroups().length;
      var nDg = getDivOptionContainers().length;
      L('page: ' + nBtn + ' btns, ' + nCb + ' cb, ' + nBg + ' btnGrp, ' + nDg + ' divGrp');

      var pageType = detectPageType();
      if (!pageType) { L('⚠ unknown page type'); processing = false; scheduleRecheck(); return; }
      L('→ ' + pageType);

      if (pageType === 'agreement') clickAgreement();
      else if (pageType === 'option_groups') clickOptionGroups();
    } catch (e) {
      L('ERROR: ' + e);
    }

    // Check for unanswered error after a short delay
    setTimeout(function () {
      if (hasUnansweredError()) {
        handleFallback(0, 10, function () { processing = false; scheduleRecheck(); });
      } else {
        processing = false;
        scheduleRecheck();
      }
    }, 300);
  }

  function scheduleRecheck() {
    setTimeout(function () { processPage(); }, 300);
  }

  function onMutation() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { processPage(); }, 10);
  }

  // ─── Dialog dismissal ─────────────────────────────────────────────────────

  function dismissResumeDialog() {
    if (dialogDismissed || !document.body) return false;
    if (document.body.textContent.indexOf('您之前已经回答了部分题目，是否继续上次回答') === -1) return false;
    var allBtns = Array.from(document.querySelectorAll('button, [role="button"], a'));
    var cancel = allBtns.find(function (b) { return b.textContent.trim().indexOf('取消') !== -1; });
    if (cancel) { cancel.click(); dialogDismissed = true; lastKey = ''; L('dismissed dialog (取消)'); return true; }
    var next = allBtns.find(function (b) { return b.textContent.trim().indexOf('下一页') !== -1; });
    if (next) { next.click(); dialogDismissed = true; lastKey = ''; L('dismissed dialog (下一页)'); return true; }
    L('⚠ dialog detected but no button found');
    return false;
  }

  // ─── Bootstrap (pure setTimeout, no async) ────────────────────────────

  function bootstrap() {
    L('bootstrap: waiting 1s...');
    setTimeout(function () {
      var dObs = new MutationObserver(function () { if (!dialogDismissed) dismissResumeDialog(); });
      dObs.observe(document.body, { childList: true, subtree: true });

      if (dismissResumeDialog()) {
        L('dialog dismissed, waiting 1s...');
        setTimeout(function () { startProcessing(); }, 1000);
      } else {
        startProcessing();
      }
    }, 1000);
  }

  function startProcessing() {
    processPage();
    new MutationObserver(onMutation).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
  else bootstrap();
})();
