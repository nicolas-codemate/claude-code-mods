import { scanMarkup } from './markup'
import type { MarkupTemplating } from './markup'
import { OPENING_BRACE, offsetOfLineEnd } from './scanning'
import type { TokenCollector } from './scanning'
import { scanScript } from './script'

const VUE_TEMPLATING: MarkupTemplating = {
  startsConstructAt: (text, offset, place) => place === 'content' && text.charCodeAt(offset + 1) === OPENING_BRACE,
  // "{{ order.total }}": an expression of the script family between the braces. Left open, it ends with its line.
  scanConstruct: (text, offset, end, collector) => {
    const closingOffset = text.indexOf('}}', offset + 2)
    const isClosed = closingOffset !== -1 && closingOffset < end
    const expressionEnd = isClosed ? closingOffset : offsetOfLineEnd(text, offset, end)
    collector.add(offset, offset + 2, 'punctuation', false)
    scanScript(text, offset + 2, expressionEnd, collector, false)
    if (!isClosed) {
      return expressionEnd
    }
    collector.add(expressionEnd, expressionEnd + 2, 'punctuation', false)

    return expressionEnd + 2
  },
  // ":total", "@submit", "#item" and "v-if" hold an expression, any other attribute a plain string.
  isScriptAttribute: attributeName =>
    attributeName.startsWith(':') ||
    attributeName.startsWith('@') ||
    attributeName.startsWith('#') ||
    attributeName.startsWith('v-'),
  builtInTagNames: new Set([
    'Component', 'KeepAlive', 'RouterLink', 'RouterView', 'Suspense', 'Teleport', 'Transition', 'TransitionGroup',
    'keep-alive', 'router-link', 'router-view', 'transition-group',
  ]),
  areTagNamesCaseSensitive: true,
}

// A single-file component: its <template> is markup whose bound attributes and "{{ }}" hold script, its <script>
// is script, its <style> a style sheet.
export function scanVue(text: string, start: number, end: number, collector: TokenCollector): void {
  scanMarkup(text, start, end, collector, VUE_TEMPLATING)
}
