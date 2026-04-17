<script setup lang="ts">
import { useMushi } from '@mushi-mushi/vue'

const { open } = useMushi()
</script>

<template>
  <main>
    <div>
      <h1>Mushi Mushi 🪲 — Vue</h1>
      <p>
        Press <kbd>Ctrl+Shift+B</kbd> or click below.
      </p>
      <button @click="open">Report a bug</button>
    </div>
  </main>
</template>

<style scoped>
main { min-height: 100vh; display: grid; place-items: center; text-align: center; }
div { max-width: 32rem; padding: 2rem; }
h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
p { color: #a1a1aa; line-height: 1.6; }
button {
  margin-top: 1.25rem; padding: 0.6rem 1.1rem; border: 0;
  border-radius: 8px; background: #6366f1; color: white;
  font-weight: 600; cursor: pointer;
}
button:hover { background: #4f46e5; }
</style>
