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
        elif page_type == "button_groups":
            code = self._button_groups_js()
        elif page_type == "div_options":
            code = self._div_options_js()
        elif page_type == "div_grid":
            code = self._div_grid_js()
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
    # JS generator: button_groups
    # ------------------------------------------------------------------

    def _button_groups_js(self) -> str:
        advance = self._click_advance_js()
        return (
            "(function(){"
            "  console.log('[zmd] exec: button_groups');"
            "  var allBtns = Array.from(document.querySelectorAll('button'));"
            "  var groupMap = new Map();"
            "  allBtns.forEach(function(b){"
            "    var p = b.parentElement;"
            "    if(!groupMap.has(p)){ groupMap.set(p, []); }"
            "    groupMap.get(p).push(b);"
            "  });"
            "  var clickedCount = 0;"
            "  groupMap.forEach(function(btns){"
            "    if(btns.length >= 2){"
            "      var idx = btns.length - 2;"
            "      console.log('[zmd] button_groups: clicking btn[' + idx + '] of ' + btns.length + ' in group, text:', btns[idx].textContent.trim());"
            "      btns[idx].click();"
            "      clickedCount++;"
            "    }"
            "  });"
            "  console.log('[zmd] button_groups: clicked', clickedCount, 'groups');"
            "  setTimeout(function(){"
            f"    {advance}"
            "  }, 100);"
            "})();"
        )

    # ------------------------------------------------------------------
    # JS generator: div_grid
    # Handles uniform deeply-nested div grids (sliders, rating grids).
    # Finds the same container as getDivGridContainer() in inject.js and
    # clicks the second-to-last child (index len-2).
    # ------------------------------------------------------------------

    def _div_grid_js(self) -> str:
        advance = self._click_advance_js()
        return (
            "(function(){"
            "  console.log('[zmd] exec: div_grid');"
            "  function getDivGridDepth(el){"
            "    if(el.tagName !== 'DIV') return 0;"
            "    var kids = Array.from(el.children);"
            "    if(kids.length === 0) return 1;"
            "    if(kids.length !== 1) return 0;"
            "    var d = getDivGridDepth(kids[0]);"
            "    return d > 0 ? d + 1 : 0;"
            "  }"
            "  var found = null;"
            "  var allDivs = Array.from(document.querySelectorAll('div'));"
            "  for(var i = 0; i < allDivs.length; i++){"
            "    var el = allDivs[i];"
            "    var kids = Array.from(el.children);"
            "    if(kids.length < 3) continue;"
            "    var depths = kids.map(getDivGridDepth);"
            "    if(depths[0] < 2) continue;"
            "    if(depths.every(function(d){ return d === depths[0]; })){ found = el; break; }"
            "  }"
            "  if(found){"
            "    var children = Array.from(found.children);"
            "    var idx = children.length - 2;"
            "    console.log('[zmd] div_grid: clicking child[' + idx + '] of ' + children.length);"
            "    children[idx].click();"
            "  } else { console.warn('[zmd] div_grid: container not found'); }"
            "  setTimeout(function(){"
            f"    {advance}"
            "  }, 100);"
            "})();"
        )

    # ------------------------------------------------------------------
    # JS generator: div_options
    # ------------------------------------------------------------------

    def _div_options_js(self) -> str:
        advance = self._click_advance_js()
        return (
            "(function(){"
            "  console.log('[zmd] exec: div_options');"
            # Find the container: a div whose direct children are all divs,
            # each child has exactly 2 child divs, second of which has 2 child divs.
            "  function isOptionChild(el){"
            "    if(el.tagName !== 'DIV') return false;"
            "    var kids = Array.from(el.children);"
            "    if(kids.length !== 2) return false;"
            "    var second = kids[1];"
            "    return second.tagName === 'DIV' && second.children.length === 2;"
            "  }"
            "  function isContainer(el){"
            "    var kids = Array.from(el.children);"
            "    if(kids.length < 3 || kids.length > 7) return false;"
            "    return kids.every(function(k){ return k.tagName === 'DIV' && isOptionChild(k); });"
            "  }"
            "  var containers = Array.from(document.querySelectorAll('div')).filter(isContainer);"
            "  console.log('[zmd] div_options: found', containers.length, 'containers');"
            "  if(containers.length > 0){"
            "    var c = containers[0];"
            "    var children = Array.from(c.children);"
            "    var idx = children.length - 2;"
            "    console.log('[zmd] div_options: clicking child[' + idx + '] of ' + children.length);"
            "    children[idx].click();"
            "  }"
            "  setTimeout(function(){"
            f"    {advance}"
            "  }, 100);"
            "})();"
        )
