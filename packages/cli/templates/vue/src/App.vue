<script setup lang="ts">
function throwDemoError(): void {
  throw new Error('Demo error — check your Mushi dashboard for the report')
}
</script>

<template>
  <main style="font-family: system-ui; padding: 2rem; max-width: 40rem; margin: 0 auto">
    <h1>Mushi Mushi + Vue 3</h1>
    <p>
      The Mushi widget is mounted. Shake your phone (mobile) or use the floating
      button to file a bug report — or trigger a demo error:
    </p>
    <button @click="throwDemoError">Throw a demo error</button>
    <p>
      Reports land in your
      <a href="https://kensaur.us/mushi-mushi/admin" target="_blank" rel="noreferrer">
        Mushi console</a
      >, diagnosed in plain English.
    </p>
  </main>
</template>
