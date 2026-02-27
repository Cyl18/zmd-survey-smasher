"""
AnswerStrategy: rule-based JS generation for survey auto-fill.
Swap decide() with an LLM subclass later without touching WS plumbing.
"""
from __future__ import annotations


class AnswerStrategy:
    def __init__(self, debug_no_submit: bool = False) -> None:
        self.debug_no_submit = debug_no_submit

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _advance_texts_js(self) -> str:
        """Return the JS array literal for advance button text matching."""
        if self.debug_no_submit:
            return "['下一页']"
        return "['下一页','提交']"

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
    # Unified handler for all question types that present selectable options
    # as either <button> or <div> elements with non-empty text content.
    # Groups elements by their direct parent, keeps only "leaf" groups
    # (elements that are not themselves parents of another group), then
    # clicks the second-to-last element in each group.
    # ------------------------------------------------------------------

    def _option_groups_js(self) -> str:
        advance = self._click_advance_js()
        return (
            "(function(){"
            "  console.log('[zmd] exec: option_groups');"
            "  var SKIP = ['下一页','提交','上一页'];"
            "  var candidates = Array.from(document.querySelectorAll('button, div')).filter(function(el){"
            "    var text = el.textContent.trim();"
            "    if(!text) return false;"
            "    if(SKIP.includes(text)) return false;"
            "    return true;"
            "  });"
            "  var map = new Map();"
            "  candidates.forEach(function(el){"
            "    var p = el.parentElement;"
            "    if(!p) return;"
            "    if(!map.has(p)) map.set(p, []);"
            "    map.get(p).push(el);"
            "  });"
            "  var groups = [];"
            "  map.forEach(function(els, parent){"
            "    if(els.length < 2) return;"
            "    var tag = els[0].tagName;"
            "    if(!els.every(function(e){ return e.tagName === tag; })) return;"
            "    groups.push({ parent: parent, els: els });"
            "  });"
            "  var allGroupParents = new Set(groups.map(function(g){ return g.parent; }));"
            "  groups = groups.filter(function(g){"
            "    return !g.els.some(function(e){ return allGroupParents.has(e); });"
            "  });"
            "  console.log('[zmd] option_groups: found', groups.length, 'groups');"
            "  var clickedCount = 0;"
            "  groups.forEach(function(g){"
            "    var els = g.els;"
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
