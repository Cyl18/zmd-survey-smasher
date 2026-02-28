"""
AnswerStrategy: rule-based JS generation for survey auto-fill.
Swap decide() with an LLM subclass later without touching WS plumbing.
"""
from __future__ import annotations


class AnswerStrategy:
    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _advance_texts_js(self) -> str:
        """Return the JS array literal for advance button text matching."""
        return "['下一页']"

    def _click_advance_js(self) -> str:
        """Return JS snippet that finds and clicks the advance button."""
        texts = self._advance_texts_js()
        return (
            f"var advBtn = Array.from(document.querySelectorAll('button'))"
            f".find(function(b){{ return {texts}.includes(b.textContent.trim()); }});"
            f"if(advBtn){{ advBtn.click(); }}"
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def decide(self, payload: dict) -> dict:
        """
        Given a query payload from the JS side, return:
            {"type": "eval", "code": "<JS string>"}
        """
        page_type = payload.get("page_type", "")

        if page_type == "agreement":
            code = self._agreement_js()
        elif page_type == "option_groups":
            code = self._option_groups_js()
        else:
            code = "console.warn('zmd-survey-smasher: unknown page_type', " + repr(page_type) + ");"

        return {"type": "eval", "code": code}

    # ------------------------------------------------------------------
    # JS generator: agreement
    # ------------------------------------------------------------------

    def _agreement_js(self) -> str:
        advance = self._click_advance_js()
        return (
            "(function(){"
            "  console.log('[zmd] exec: agreement');"
            "  var input = document.querySelector('input[type=\"checkbox\"]');"
            "  if(input){"
            "    var label = input.closest('label');"
            "    try{"
            "      if(label){ label.click(); console.log('[zmd] clicked label to check agreement'); }"
            "      else if(!input.checked){ input.click(); console.log('[zmd] clicked input to check agreement'); }"
            "    }catch(e){ console.warn('[zmd] agreement click failed', e); }"
            "    try{ input.dispatchEvent(new Event('change', { bubbles: true })); }catch(e){}"
            "    try{ if(typeof wsSendLog === 'function') wsSendLog('agreement clicked'); }catch(e){}"
            "  }else{ console.warn('[zmd] agreement input not found'); }"
            "  setTimeout(function(){"
            f"    {advance}"
            "  }, 100);"
            "})();"
        )

    # ------------------------------------------------------------------
    # JS generator: option_groups
    # Two-phase detection matching inject.js:
    #   Phase 1 — button groups (group by parent, ≥2 per group)
    #   Phase 2 — div option containers (3–10 child divs each with ≥2 children)
    # Clicks the second-to-last element in each group.
    # ------------------------------------------------------------------

    def _option_groups_js(self) -> str:
        advance = self._click_advance_js()
        return (
            "(function(){"
            "  console.log('[zmd] exec: option_groups');"
            "  var SKIP = ['下一页','提交','上一页'];"
            # Phase 1: button groups
            "  var allBtns = Array.from(document.querySelectorAll('button')).filter(function(b){"
            "    var t = b.textContent.trim(); return t && !SKIP.includes(t);"
            "  });"
            "  var btnMap = new Map();"
            "  allBtns.forEach(function(b){"
            "    var p = b.parentElement;"
            "    if(!p) return;"
            "    if(!btnMap.has(p)) btnMap.set(p, []);"
            "    btnMap.get(p).push(b);"
            "  });"
            "  var groups = [];"
            "  btnMap.forEach(function(btns){ if(btns.length >= 2) groups.push(btns); });"
            # Phase 2: div option containers (only if no button groups)
            "  if(groups.length === 0){"
            "    var allDivs = Array.from(document.querySelectorAll('div'));"
            "    for(var i = 0; i < allDivs.length; i++){"
            "      var el = allDivs[i];"
            "      var kids = Array.from(el.children);"
            "      if(kids.length < 3 || kids.length > 10) continue;"
            "      var ok = kids.every(function(k){ return k.tagName === 'DIV' && k.children.length >= 2; });"
            "      if(ok) groups.push(kids);"
            "    }"
            "  }"
            "  console.log('[zmd] option_groups: found', groups.length, 'groups');"
            "  var clickedCount = 0;"
            "  groups.forEach(function(els){"
            "    var idx = els.length - 2;"
            "    if(idx < 0) idx = 0;"
            "    console.log('[zmd] option_groups: clicking [' + idx + '] of ' + els.length + ', text:', els[idx].textContent.trim().slice(0,30));"
            "    els[idx].click();"
            "    clickedCount++;"
            "  });"
            "  console.log('[zmd] option_groups: clicked', clickedCount, 'groups');"
            "  setTimeout(function(){"
            f"    {advance}"
            "  }, 100);"
            "})();"
        )
