// inject.js — injected by mitmproxy into survey.hypergryph.com HTML pages
// {{DEBUG_NO_SUBMIT}} is substituted at intercept time.
// NOTE: no async/await — some QtWebEngine builds break on it silently.
// NOTE: Chrome/87 compat — no <pre>, no vh units, all styles !important.
(function () {
  'use strict';

  var DEBUG_NO_SUBMIT = {{DEBUG_NO_SUBMIT}};
  var WS_PORT = {{WS_PORT}};
  var ADVANCE_TEXTS = DEBUG_NO_SUBMIT ? ['下一页'] : ['下一页', '提交'];
  var SKIP_BUTTON_TEXTS = ['下一页', '提交', '上一页'];
  var dialogDismissed = false;

  // ─── Local WebSocket (debug / log forwarding) ─────────────────────────────

  var _ws = null;
  var _wsQueue = [];

  function _sendWS(obj) {
    if (!WS_PORT) return;
    var msg = JSON.stringify(obj);
    if (_ws && _ws.readyState === 1) { try { _ws.send(msg); } catch(e) {} return; }
    _wsQueue.push(msg);
    if (_wsQueue.length > 200) _wsQueue.shift();
  }

  function _connectWS() {
    if (!WS_PORT) return;
    try {
      var ws = new WebSocket('ws://127.0.0.1:' + WS_PORT);
      ws.onopen = function () {
        _ws = ws;
        var q = _wsQueue.splice(0);
        q.forEach(function (m) { try { ws.send(m); } catch(e) {} });
      };
      ws.onclose = function () { if (_ws === ws) _ws = null; setTimeout(_connectWS, 3000); };
      ws.onerror = function () {};
    } catch(e) { setTimeout(_connectWS, 5000); }
  }
  if (WS_PORT) setTimeout(_connectWS, 500);

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
    _sendWS({ type: 'log', message: msg });
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

  // Check if a DOM node belongs to our injected UI (log panel / badge).
  function isOwnUI(node) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    while (el) {
      if (el.id === 'zmd-log' || el.id === 'zmd-badge') return true;
      el = el.parentElement;
    }
    return false;
  }

  function findAdvanceButton() {
    return Array.from(document.querySelectorAll('button'))
      .find(function (b) {
        var text = b.textContent.trim();
        return ADVANCE_TEXTS.some(function (t) { return text.indexOf(t) !== -1; });
      });
  }

  // Check whether a navigation-text fragment appears in a button's text.
  function isNavText(text) {
    return SKIP_BUTTON_TEXTS.some(function (t) { return text.indexOf(t) !== -1; });
  }

  function detectAgreement() {
    var cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    for (var i = 0; i < cbs.length; i++) {
      var cb = cbs[i];
      if (cb.checked) continue;
      var label = cb.closest('label');
      if (label && label.textContent.indexOf('我已阅读，并同意以上内容') !== -1) return true;
      var el = cb.parentElement;
      for (var j = 0; j < 5 && el; j++) {
        if (el.textContent && el.textContent.indexOf('我已阅读，并同意以上内容') !== -1) return true;
        el = el.parentElement;
      }
    }
    return false;
  }

  // ─── Option-group detection ──────────────────────────────────────────────
  // Multi-phase detection:
  //   Phase 1 — button groups: group <button> by parentElement, keep ≥2.
  //   Phase 2 — div option containers (strict): container div with 3–10
  //             child divs each having ≥2 children (icon+text pattern).
  //   Phase 3 — div option containers (relaxed): container div with 3+
  //             child divs that have text content (deeply nested leaves).
  //   Phase 4 — checkbox groups: non-agreement checkboxes grouped by
  //             nearest shared ancestor.

  function getButtonGroups() {
    var allBtns = Array.from(document.querySelectorAll('button')).filter(function (b) {
      if (isOwnUI(b)) return false;
      var text = b.textContent.trim();
      // Exclude buttons whose text contains a navigation label (indexOf, not exact).
      // Buttons with no text (icon/image buttons) are kept.
      if (text && isNavText(text)) return false;
      return true;
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
    var allDivs = Array.from(document.querySelectorAll('div'));
    var containers = [];
    for (var i = 0; i < allDivs.length; i++) {
      var el = allDivs[i];
      if (isOwnUI(el)) continue;
      var kids = Array.from(el.children);
      if (kids.length < 2 || kids.length > 30) continue;

      // Phase 0 — mixed direct-button containers: mostly button children with
      // optional decorator divs/spans.
      // Handles: container > [button * N, div (separator), button (其他)]
      var directBtns = kids.filter(function (k) {
        if (k.tagName !== 'BUTTON') return false;
        var text = k.textContent.trim();
        return !text || SKIP_BUTTON_TEXTS.indexOf(text) === -1;
      });
      if (directBtns.length >= 2 && directBtns.length >= kids.length * 0.4) {
        containers.push(directBtns);
        continue;
      }

      // Phase 1 — wrapped-button containers: each child div/li wraps exactly
      // one option button.  Handles: container > [div > button] * N
      var wrappedBtns = [];
      for (var j = 0; j < kids.length; j++) {
        var wk = kids[j];
        if (wk.tagName !== 'DIV' && wk.tagName !== 'LI' && wk.tagName !== 'SPAN') continue;
        var innerBtns = wk.querySelectorAll('button');
        if (innerBtns.length !== 1) continue;
        var btext = innerBtns[0].textContent.trim();
        if (btext && SKIP_BUTTON_TEXTS.indexOf(btext) !== -1) continue;
        wrappedBtns.push(innerBtns[0]);
      }
      if (wrappedBtns.length >= 2 && wrappedBtns.length >= kids.length * 0.4) {
        containers.push(wrappedBtns);
        continue;
      }

      if (kids.length < 3) continue;  // remaining phases need ≥3 children

      // Phase 2 — strict: all children are divs with ≥2 children (icon+text)
      var allStructured = kids.length <= 10 && kids.every(function (k) {
        return k.tagName === 'DIV' && k.children.length >= 2;
      });
      if (allStructured) { containers.push(kids); continue; }

      // Phase 3 — relaxed: most children are divs with text, no buttons/text-inputs.
      // Allows radio/checkbox inputs (they are the option selectors).
      // Filters out the button container and empty divs.
      var optionDivs = kids.filter(function (k) {
        if (k.tagName !== 'DIV') return false;
        if (isOwnUI(k)) return false;
        if (k.querySelector('button')) return false;
        if (k.querySelector('input:not([type="radio"]):not([type="checkbox"])')) return false;
        var text = k.textContent.trim();
        return text.length > 0 && text.length < 500;
      });
      // Need at least 3 option-like divs and they should be the majority
      if (optionDivs.length >= 3 && optionDivs.length >= kids.length * 0.5) {
        containers.push(optionDivs);
      }
    }
    return containers;
  }

  // Find non-agreement checkboxes, grouped by nearest shared container.
  function getCheckboxGroups() {
    var agreementText = '我已阅读，并同意以上内容';
    var allCbs = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(function (cb) {
      // Walk up to check if this is the agreement checkbox
      var el = cb;
      for (var i = 0; i < 6 && el; i++) {
        if (el.textContent && el.textContent.indexOf(agreementText) !== -1) return false;
        el = el.parentElement;
      }
      return true;
    });
    if (allCbs.length < 2) return [];

    // Group by nearest ancestor that contains ≥2 checkboxes
    var map = new Map();
    allCbs.forEach(function (cb) {
      var container = cb.parentElement;
      for (var i = 0; i < 8 && container && container !== document.body; i++) {
        if (container.querySelectorAll('input[type="checkbox"]').length >= 2) break;
        container = container.parentElement;
      }
      if (!container) container = document.body;
      if (!map.has(container)) map.set(container, []);
      map.get(container).push(cb);
    });
    var groups = [];
    map.forEach(function (cbs) {
      if (cbs.length >= 2) groups.push(cbs);
    });
    return groups;
  }

  // Find radio button groups by name attribute (or shared ancestor as fallback).
  function getRadioGroups() {
    var allRadios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(function (r) {
      return !isOwnUI(r);
    });
    if (allRadios.length < 2) return [];
    var map = new Map();
    allRadios.forEach(function (r) {
      var key = r.name || '__noname__';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    var groups = [];
    map.forEach(function (radios) {
      if (radios.length >= 2) groups.push(radios);
    });
    return groups;
  }

  function getOptionGroups() {
    var btnGroups = getButtonGroups();
    var divGroups = getDivOptionContainers();

    // divGroups whose every element is a <button> are just the parent containers
    // of btnGroups re-detected — they duplicate btnGroups and must be excluded.
    // divGroups with non-button elements are genuinely separate questions (e.g.
    // a satisfaction scale rendered as divs alongside button-based questions).
    var divOnly = divGroups.filter(function (grp) {
      return grp.every(function (el) { return el.tagName !== 'BUTTON'; });
    });

    var combined = btnGroups.concat(divOnly);
    if (combined.length > 0) return combined;

    var radioGroups = getRadioGroups();
    if (radioGroups.length > 0) return radioGroups;
    return [];
  }

  function detectPageType() {
    if (detectAgreement()) return 'agreement';
    if (getOptionGroups().length > 0) return 'option_groups';
    if (getCheckboxGroups().length > 0) return 'checkbox_groups';
    return null;
  }

  // ─── Debug report (sent to WS server for analysis) ───────────────────────

  function _sendDebug(pageType) {
    if (!WS_PORT) return;
    var btnGrps = getButtonGroups();
    var divGrps = getDivOptionContainers();
    var allBtns = Array.from(document.querySelectorAll('button'))
      .filter(function (b) { return !isOwnUI(b); })
      .map(function (b) { return b.textContent.trim().slice(0, 50); });
    _sendWS({
      type: 'debug',
      url: location.href,
      page_type: pageType || null,
      btns: allBtns,
      btn_groups: btnGrps.map(function (g) {
        return g.map(function (el) { return el.textContent.trim().slice(0, 50); });
      }),
      div_groups: divGrps.map(function (g) {
        return g.map(function (el) { return el.textContent.trim().slice(0, 50); });
      }),
    });
  }

  // ─── Inline answer actions (no server round-trip needed) ─────────────────

  // Return true if el looks like it is already in a selected/active state.
  function isOptionSelected(el) {
    if (el.getAttribute('aria-selected') === 'true') return true;
    if (el.getAttribute('aria-pressed') === 'true') return true;
    if (el.getAttribute('aria-checked') === 'true') return true;
    return false;
  }

  // Smart click: if el contains a radio/checkbox (or IS one), click that input
  // (via its label when possible) and fire a change event.  Falls back to a
  // plain el.click() for button-style elements.
  function clickEl(el) {
    var inp = (el.tagName === 'INPUT') ? el : el.querySelector('input[type="radio"], input[type="checkbox"]');
    if (inp) {
      var lbl = inp.closest('label') || (inp.id && document.querySelector('label[for="' + inp.id + '"]'));
      try {
        if (lbl) lbl.click();
        else inp.click();
      } catch (e) {}
      try { inp.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      return;
    }
    try { el.click(); } catch (e) {}
  }

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
    setTimeout(function () { var b = findAdvanceButton(); if (b) b.click(); }, 50);
  }

  function clickOptionGroups() {
    var groups = getOptionGroups();
    L('action: option_groups, ' + groups.length + ' groups');
    groups.forEach(function (els) {
      // Skip this group if any option is already selected — re-clicking would
      // toggle it off (deselect), causing "您尚未答完此题" endlessly.
      var selIdx = -1;
      for (var i = 0; i < els.length; i++) {
        if (isOptionSelected(els[i])) { selIdx = i; break; }
      }
      if (selIdx !== -1) {
        L('  skip [already selected ' + selIdx + '/' + els.length + ']: ' + els[selIdx].textContent.trim().slice(0, 30));
        return;
      }
      var idx = Math.max(0, els.length - 2);
      L('  click [' + idx + '/' + els.length + ']: ' + els[idx].textContent.trim().slice(0, 30));
      clickEl(els[idx]);
    });
    setTimeout(function () { var b = findAdvanceButton(); if (b) b.click(); }, 50);
  }

  function clickCheckboxGroups() {
    var groups = getCheckboxGroups();
    L('action: checkbox_groups, ' + groups.length + ' groups');
    groups.forEach(function (cbs) {
      // Check 1–3 random checkboxes per group
      var n = 1 + Math.floor(Math.random() * Math.min(3, cbs.length));
      var shuffled = cbs.slice().sort(function () { return Math.random() - 0.5; });
      shuffled.slice(0, n).forEach(function (cb) {
        L('  check: ' + (cb.closest('label') || cb.parentElement || cb).textContent.trim().slice(0, 40));
        var label = cb.closest('label');
        if (label) label.click();
        else cb.click();
        try { cb.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      });
    });
    setTimeout(function () { var b = findAdvanceButton(); if (b) b.click(); }, 50);
  }

  // ─── Fallback (pure setTimeout, no async) ──────────────────────────────

  function hasUnansweredError() {
    // Exclude our own log panel from the check
    var body = document.body.cloneNode(true);
    var log = body.querySelector('#zmd-log');
    if (log) log.remove();
    return (body.textContent || '').indexOf('您尚未答完此题') !== -1;
  }

  function handleFallback(attempt, maxRetries, done) {
    attempt = attempt || 0;
    maxRetries = maxRetries || 10;
    if (attempt >= maxRetries) { lastKey = ''; L('fallback exhausted'); done(); return; }
    L('fallback ' + (attempt + 1) + '/' + maxRetries);

    // Try all interactive element types
    var groups = getOptionGroups();
    var cbGroups = getCheckboxGroups();

    if (groups.length > 0) {
      groups.forEach(function (els) {
        var n = 1 + Math.floor(Math.random() * Math.min(3, els.length));
        els.slice().sort(function () { return Math.random() - 0.5; }).slice(0, n)
          .forEach(function (e) { clickEl(e); });
      });
    }
    if (cbGroups.length > 0) {
      cbGroups.forEach(function (cbs) {
        var n = 1 + Math.floor(Math.random() * Math.min(3, cbs.length));
        cbs.slice().sort(function () { return Math.random() - 0.5; }).slice(0, n)
          .forEach(function (cb) {
            var label = cb.closest('label');
            if (label) label.click(); else cb.click();
            try { cb.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
          });
      });
    }
    if (groups.length === 0 && cbGroups.length === 0) {
      // Last resort: click random non-navigation buttons
      var btns = Array.from(document.querySelectorAll('button')).filter(function (b) {
        var text = b.textContent.trim();
        return !text || !isNavText(text);
      });
      btns.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 3)
        .forEach(function (b) { b.click(); });
    }

    setTimeout(function () {
      var adv = findAdvanceButton();
      if (adv) adv.click();
      setTimeout(function () {
        if (!hasUnansweredError()) { done(); return; }
        handleFallback(attempt + 1, maxRetries, done);
      }, 200);
    }, 100);
  }

  // ─── Navigation guard (pure setTimeout, no async) ─────────────────────

  var lastKey = '';
  var debounceTimer = null;
  var processing = false;

  // Compute a page fingerprint that excludes our injected UI elements,
  // so logging to the panel doesn't trigger re-processing.
  function pageKey() {
    var children = document.body.children;
    var count = 0;
    var textLen = 0;
    for (var i = 0; i < children.length; i++) {
      var ch = children[i];
      if (ch.id === 'zmd-log' || ch.id === 'zmd-badge') continue;
      count++;
      textLen += (ch.innerText || '').length;
    }
    return location.href + '|' + count + '|' + textLen;
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
      var nRd = document.querySelectorAll('input[type="radio"]').length;
      var nBg = getButtonGroups().length;
      var nDg = getDivOptionContainers().length;
      var nRg = getRadioGroups().length;
      var nCg = getCheckboxGroups().length;
      L('page: ' + nBtn + ' btns, ' + nCb + ' cb, ' + nRd + ' radio, ' + nBg + ' btnGrp, ' + nDg + ' divGrp, ' + nRg + ' radioGrp, ' + nCg + ' cbGrp');

      var pageType = detectPageType();
      _sendDebug(pageType);
      if (!pageType) {
        // Unknown page — try fallback if there are any interactive elements
        var hasInteractive = nBtn > 0 || nCb > 0 || nRd > 0;
        if (hasInteractive) {
          L('\u26a0 unknown page type \u2014 trying fallback');
          handleFallback(0, 10, function () { processing = false; processPage(); });
        } else {
          L('\u26a0 unknown page type (no interactive elements)');
          processing = false;
          // Don't schedule recheck — wait for MutationObserver
        }
        return;
      }
      L('\u2192 ' + pageType);

      if (pageType === 'agreement') clickAgreement();
      else if (pageType === 'option_groups') clickOptionGroups();
      else if (pageType === 'checkbox_groups') clickCheckboxGroups();
    } catch (e) {
      L('ERROR: ' + e);
    }

    // Check for unanswered error after a short delay
    setTimeout(function () {
      if (hasUnansweredError()) {
        handleFallback(0, 10, function () { processing = false; processPage(); });
      } else {
        processing = false;
        processPage();
      }
    }, 100);
  }

  function onMutation(mutations) {
    // Ignore mutations caused by our own UI (log panel, badge)
    var dominated = true;
    for (var i = 0; i < mutations.length; i++) {
      if (!isOwnUI(mutations[i].target)) { dominated = false; break; }
    }
    if (dominated) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { processPage(); }, 100);
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
    L('\u26a0 dialog detected but no button found');
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
