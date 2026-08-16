// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/mcp/src/stdout-guard.ts
 * PURPOSE: Keep stdout byte-pure for MCP's stdio JSON-RPC framing.
 *
 *          The stdio transport owns stdout exclusively: every byte on it must
 *          be a JSON-RPC 2.0 message. A single stray `console.log` (ours, a
 *          dependency's, or a debug statement someone left behind) injects
 *          non-JSON bytes into the stream, and clients (Cursor, Claude
 *          Desktop, Windsurf, …) respond by emitting parse errors and
 *          dropping the transport — a hang that looks like "the MCP server
 *          stopped working" with nothing useful in the logs.
 *
 *          Previously `src/index.ts` patched `console.log` and `console.warn`
 *          inline. That left every other stdout-bound console method
 *          (`info`, `debug`, `dir`, `table`, `group*`, `count*`, `time*`,
 *          `trace`, `assert`, `dirxml`) writing straight to stdout, and the
 *          guard was entirely absent from the `@mushi-mushi/mcp/server`
 *          export path — anyone building a stdio host on `createMushiServer`
 *          got no protection at all.
 *
 *          This module is the single implementation, imported by BOTH
 *          entrypoints (`index.ts` and `server.ts`).
 *
 * HOW: rather than hand-rolling writers (which silently lose `%s`
 *      formatting, `util.inspect` depth, timers, counters and group
 *      indentation), we build a real `node:console` Console instance whose
 *      *both* streams are stderr and rebind every console method onto it.
 *      Formatting semantics stay identical; only the destination fd changes.
 *
 * ESCAPE HATCH: `MUSHI_MCP_STDOUT_GUARD=off` restores native console
 *      behaviour (useful when embedding the factory in a non-stdio host that
 *      collects logs from stdout).
 */

import { Console } from 'node:console'

/**
 * Console methods that emit to `stdout` under Node's default Console.
 * `warn`/`error`/`trace`/`assert` already go to stderr — they are rebound
 * anyway so that a single Console instance owns all formatting state
 * (group indentation, counters, timers) and no runtime that routes them
 * differently can leak onto stdout.
 */
export const GUARDED_CONSOLE_METHODS = [
  'log',
  'info',
  'debug',
  'dir',
  'dirxml',
  'table',
  'group',
  'groupCollapsed',
  'groupEnd',
  'count',
  'countReset',
  'time',
  'timeEnd',
  'timeLog',
  'trace',
  'assert',
  'warn',
  'error',
] as const;

type GuardedMethod = (typeof GUARDED_CONSOLE_METHODS)[number];

let installed = false;

/** True once {@link installStdoutGuard} has redirected console output. */
export function isStdoutGuardInstalled(): boolean {
  return installed;
}

/**
 * Redirect every console method to stderr so stdout carries JSON-RPC only.
 *
 * Idempotent: safe to call from several entrypoints (the stdio binary and
 * the server factory both do). Returns `true` when this call performed the
 * patch, `false` when it was already installed, disabled, or the runtime has
 * no usable stderr (browser bundles importing the factory for types).
 */
export function installStdoutGuard(): boolean {
  if (installed) return false;
  // Explicit opt-out for hosts that legitimately collect logs from stdout
  // (Supabase edge log drains, container log collectors, CI).
  if (typeof process !== 'undefined' && process.env?.MUSHI_MCP_STDOUT_GUARD === 'off') {
    return false;
  }
  if (
    typeof process === 'undefined' ||
    typeof process.stderr?.write !== 'function' ||
    typeof console === 'undefined'
  ) {
    return false;
  }

  try {
    const stderrConsole = new Console({
      stdout: process.stderr,
      stderr: process.stderr,
      // Colour codes would land in the client's log pane as escape noise.
      colorMode: false,
    });
    const target = console as unknown as Record<GuardedMethod, unknown>;
    const source = stderrConsole as unknown as Record<GuardedMethod, unknown>;
    for (const method of GUARDED_CONSOLE_METHODS) {
      const fn = source[method];
      if (typeof fn === 'function') {
        target[method] = (fn as (...a: unknown[]) => unknown).bind(stderrConsole);
      }
    }
  } catch {
    // `node:console` unavailable or stderr not a stream — fall back to a
    // minimal writer. Formatting is degraded, stdout purity is not.
    const write = (...args: unknown[]) =>
      process.stderr.write(
        args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ') + '\n',
      );
    const target = console as unknown as Record<GuardedMethod, unknown>;
    for (const method of GUARDED_CONSOLE_METHODS) {
      target[method] = write;
    }
  }

  installed = true;
  return true;
}

/** JSON.stringify that never throws on cycles/BigInt (log paths must not crash). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
