// Runtime config for the admin console. The self-hosted admin image rewrites
// this file at container start from its environment (deploy/selfhost/admin).
// The hosted build ships it empty, so nothing changes there.
window.__MUSHI_RUNTIME_CONFIG__ = window.__MUSHI_RUNTIME_CONFIG__ || {};
