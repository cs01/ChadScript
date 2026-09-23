import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import CopyMarkdown from "./CopyMarkdown.vue";
import PipelineAnimation from "./PipelineAnimation.vue";
import Guarantees from "./Guarantees.vue";
import BenchBars from "./BenchBars.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "doc-before": () => h(CopyMarkdown),
    });
  },
  enhanceApp({ app }) {
    app.component("PipelineAnimation", PipelineAnimation);
    app.component("Guarantees", Guarantees);
    app.component("BenchBars", BenchBars);
  },
} satisfies Theme;
