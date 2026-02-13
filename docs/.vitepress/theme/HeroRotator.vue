<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const phrases = [
  'Native Binaries',
  'High Performance Servers',
  'Fast CLI Tools',
  'Standalone Executables',
  'Instant Startup Services',
]

let timer: ReturnType<typeof setTimeout> | undefined
let currentIndex = 0
let rotatingEl: HTMLElement | null = null

function scheduleNext() {
  timer = setTimeout(async () => {
    if (!rotatingEl) return

    await rotatingEl.animate(
      [
        { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: 'translateX(-40px)' },
      ],
      { duration: 350, easing: 'ease-in-out', fill: 'forwards' }
    ).finished

    if (!rotatingEl) return
    currentIndex = (currentIndex + 1) % phrases.length
    rotatingEl.textContent = phrases[currentIndex]

    await rotatingEl.animate(
      [
        { opacity: 0, transform: 'translateX(40px)' },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      { duration: 350, easing: 'ease-in-out', fill: 'forwards' }
    ).finished

    scheduleNext()
  }, 3000)
}

function setup() {
  const textEl = document.querySelector('.VPHero .text') as HTMLElement | null
  if (!textEl) return false

  textEl.innerHTML = 'Compiles TypeScript to <span class="hero-rotating">Native Binaries</span>'
  rotatingEl = textEl.querySelector('.hero-rotating')
  if (!rotatingEl) return false

  rotatingEl.style.whiteSpace = 'nowrap'
  let maxWidth = 0
  for (const phrase of phrases) {
    rotatingEl.textContent = phrase
    maxWidth = Math.max(maxWidth, rotatingEl.offsetWidth)
  }
  rotatingEl.textContent = phrases[0]
  rotatingEl.style.minWidth = maxWidth + 'px'
  rotatingEl.style.whiteSpace = ''

  scheduleNext()
  return true
}

onMounted(() => {
  if (setup()) return
  let attempts = 0
  const poller = setInterval(() => {
    if (setup() || ++attempts > 20) clearInterval(poller)
  }, 100)
})

onUnmounted(() => {
  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }
  rotatingEl = null
  currentIndex = 0
})
</script>

<template>
  <ClientOnly>
    <span class="hero-rotator-anchor" />
  </ClientOnly>
</template>
