import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import CopyMarkdown from './CopyMarkdown.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(CopyMarkdown)
    })
  }
}
