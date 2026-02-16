import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import CopyMarkdown from './CopyMarkdown.vue'
import BenchmarkChart from './BenchmarkChart.vue'
import BenchmarkBars from './BenchmarkBars.vue'
import BenchmarkRace from './BenchmarkRace.vue'
import HeroRotator from './HeroRotator.vue'
import ComparisonCards from './ComparisonCards.vue'
import IRShowcase from './IRShowcase.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(CopyMarkdown)
    })
  },
  enhanceApp({ app }) {
    app.component('BenchmarkChart', BenchmarkChart)
    app.component('BenchmarkBars', BenchmarkBars)
    app.component('BenchmarkRace', BenchmarkRace)
    app.component('HeroRotator', HeroRotator)
    app.component('ComparisonCards', ComparisonCards)
    app.component('IRShowcase', IRShowcase)
  }
}
