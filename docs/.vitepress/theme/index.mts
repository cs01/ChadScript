import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import CopyMarkdown from './CopyMarkdown.vue'
import HeroRotator from './HeroRotator.vue'
import ComparisonCards from './ComparisonCards.vue'
import PipelineAnimation from './PipelineAnimation.vue'
import HeroBenchmarks from './HeroBenchmarks.vue'
import BenchmarkBars from './BenchmarkBars.vue'
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
    app.component('PipelineAnimation', PipelineAnimation)
    app.component('HeroBenchmarks', HeroBenchmarks)
    app.component('BenchmarkBars', BenchmarkBars)
  }
}
