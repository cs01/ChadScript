import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import CopyMarkdown from './CopyMarkdown.vue'
import HeroRotator from './HeroRotator.vue'
import ComparisonCards from './ComparisonCards.vue'
import IRShowcase from './IRShowcase.vue'
import ExampleTabs from './ExampleTabs.vue'
import HeroBenchmarks from './HeroBenchmarks.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(CopyMarkdown),
    })
  },
  enhanceApp({ app }) {
    app.component('HeroRotator', HeroRotator)
    app.component('ComparisonCards', ComparisonCards)
    app.component('IRShowcase', IRShowcase)
    app.component('ExampleTabs', ExampleTabs)
    app.component('HeroBenchmarks', HeroBenchmarks)
  }
}
