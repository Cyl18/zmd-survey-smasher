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

  // ─── Page detection ───────────────────────────────────────────────────────

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

    // Button groups by parent
    var groupMap = new Map();
    allBtns.forEach(function (b) {
      var p = b.parentElement;
      if (!groupMap.has(p)) groupMap.set(p, []);
      groupMap.get(p).push(b);
    });
    var gi = 0;
    groupMap.forEach(function (btns, parent) {
      if (btns.length >= 2) {
        lines.push('  Group[' + gi + '] (' + btns.length + ' btns) parent=' + parentPath(parent, 3)
          + ' texts=[' + btns.map(function (b) { return JSON.stringify(b.textContent.trim().slice(0, 20)); }).join(', ') + ']');
        gi++;
      }
    });

    // Checkbox
    var cb = document.querySelector('input[type="checkbox"]');
    if (cb) {
      lines.push('Checkbox: checked=' + cb.checked + ' path=' + parentPath(cb, 4));
    }

    // Div options containers (icon+text structure)
    var divContainers = Array.from(document.querySelectorAll('div')).filter(isContainer);
    lines.push('Div option containers: ' + divContainers.length);
    divContainers.forEach(function (c, i) {
      var kids = Array.from(c.children);
      lines.push('  Container[' + i + '] (' + kids.length + ' children) path=' + parentPath(c, 3));
    });

    // Div grid containers (uniform deep nesting)
    var gc = getDivGridContainer();
    if (gc) {
      var gkids = Array.from(gc.children);
      lines.push('Div grid container: ' + gkids.length + ' children, path=' + parentPath(gc, 3));
    } else {
      lines.push('Div grid container: none');
    }

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

  function getButtonGroups() {
    var allBtns = Array.from(document.querySelectorAll('button'));
    var map = new Map();
    allBtns.forEach(function (b) {
      var p = b.parentElement;
      if (!map.has(p)) map.set(p, []);
      map.get(p).push(b);
    });
    var groups = [];
    map.forEach(function (btns) {
      if (btns.length >= 2) groups.push(btns);
    });
    return groups;
  }

  function isOptionChild(el) {
    if (el.tagName !== 'DIV') return false;
    var kids = Array.from(el.children);
    if (kids.length !== 2) return false;
    var second = kids[1];
    return second.tagName === 'DIV' && second.children.length === 2;
  }

  function isContainer(el) {
    var kids = Array.from(el.children);
    if (kids.length < 3 || kids.length > 7) return false;
    return kids.every(function (k) { return k.tagName === 'DIV' && isOptionChild(k); });
  }

  function getDivOptionsContainer() {
    return Array.from(document.querySelectorAll('div')).find(isContainer) || null;
  }

  // div_grid: a container whose children are all divs with a uniform single-child
  // nesting chain (depth ≥2). Handles sliders, rating grids, etc.
  // Each child: div > div > ... (any uniform depth, all children structurally identical).
  function getDivGridDepth(el) {
    // Returns depth of single-child div chain, or 0 if not uniform.
    if (el.tagName !== 'DIV') return 0;
    var kids = Array.from(el.children);
    if (kids.length === 0) return 1;  // leaf
    if (kids.length !== 1) return 0;  // not single-child
    var d = getDivGridDepth(kids[0]);
    return d > 0 ? d + 1 : 0;
  }

  function getDivGridContainer() {
    var allDivs = Array.from(document.querySelectorAll('div'));
    for (var i = 0; i < allDivs.length; i++) {
      var el = allDivs[i];
      var kids = Array.from(el.children);
      if (kids.length < 3) continue;
      // All children must be DIVs with the same uniform depth ≥2
      var depths = kids.map(getDivGridDepth);
      if (depths[0] < 2) continue;
      var allSame = depths.every(function (d) { return d === depths[0]; });
      if (allSame) return el;
    }
    return null;
  }

  function detectCheckboxOptions() {
    // Any page with ≥1 checkbox that wasn't caught by detectAgreement()
    return document.querySelectorAll('input[type="checkbox"]').length >= 1;
  }

  function detectPageType() {
    if (detectAgreement()) return 'agreement';
    if (getButtonGroups().length > 0) return 'button_groups';
    if (getDivOptionsContainer()) return 'div_options';
    if (getDivGridContainer()) return 'div_grid';
    if (detectCheckboxOptions()) return 'checkbox_options';
    return null;
  }

  function buildGroups(pageType) {
    if (pageType === 'agreement') return [];
    if (pageType === 'button_groups') {
      return getButtonGroups().map(function (btns, i) {
        return {
          index: i,
          option_texts: btns.map(function (b) { return b.textContent.trim(); })
        };
      });
    }
    if (pageType === 'div_options') {
      var container = getDivOptionsContainer();
      if (!container) return [];
      var texts = Array.from(container.children).map(function (c) {
        var textArea = c.children[1];
        return textArea ? textArea.textContent.trim() : '';
      });
      return [{ index: 0, option_texts: texts }];
    }
    if (pageType === 'div_grid') {
      var gc = getDivGridContainer();
      if (!gc) return [];
      var kids = Array.from(gc.children);
      return [{ index: 0, option_texts: kids.map(function (k) { return k.textContent.trim(); }) }];
    }
    if (pageType === 'checkbox_options') {
      var cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      return [{
        index: 0,
        option_texts: cbs.map(function (cb) {
          var label = cb.closest('label');
          return label ? label.textContent.trim() : '';
        })
      }];
    }
    return [];
  }

  // ─── Fallback: 您尚未答完此题 ──────────────────────────────────────────────

  function hasUnansweredError() {
    return document.body.textContent.includes('您尚未答完此题');
  }

  async function handleFallback(retries) {
    retries = retries === undefined ? 3 : retries;
    for (var attempt = 0; attempt < retries; attempt++) {
      console.warn('[zmd] fallback attempt ' + (attempt + 1));
      wsSendLog('[zmd] fallback attempt ' + (attempt + 1));

      // Randomly click options from every detected group.
      // Filter out any buttons that look like navigation (下一页/提交/上一页).
      var groups = getButtonGroups();
      if (groups.length > 0) {
        groups.forEach(function (btns) {
          var options = btns.filter(function (b) {
            return !SKIP_BUTTON_TEXTS.includes(b.textContent.trim());
          });
          if (options.length === 0) return;
          var count = 1 + Math.floor(Math.random() * Math.min(2, options.length));
          var shuffled = options.slice().sort(function () { return Math.random() - 0.5; });
          shuffled.slice(0, count).forEach(function (b) {
            console.log('[zmd] fallback: clicking button:', b.textContent.trim());
            b.click();
          });
        });
      } else {
        var container = getDivOptionsContainer();
        if (container) {
          var kids = Array.from(container.children);
          var idx = Math.floor(Math.random() * kids.length);
          console.log('[zmd] fallback: clicking div option index', idx);
          kids[idx].click();
        }
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
    // Reset lastKey so the page can be retried on next DOM mutation
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
        await handleFallback(3);
      }
    } finally {
      processing = false;
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
