#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Comprehensive MCP tool test against yen-yen project.
Tests all 41 tools and reports pass/fail/skip with response summaries.
Run: python packages/mcp/scripts/test-all-tools-yenyen.py
"""
import json
import subprocess
import os
import sys
import time
import threading
import hashlib

# Force UTF-8 output on Windows
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# All connection values are read from the environment so no secret is ever
# committed. Set them before running, e.g.:
#   export MUSHI_API_KEY="mushi_..."          # an mcp:read + mcp:write key
#   export MUSHI_API_ENDPOINT="https://<ref>.supabase.co/functions/v1/api"
#   export MUSHI_PROJECT_ID="<project uuid>"
#   export MCP_BIN="<abs path to packages/mcp/dist/index.js>"
_repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MCP_BIN    = os.environ.get("MCP_BIN") or os.path.join(_repo_root, "packages", "mcp", "dist", "index.js")
ENDPOINT   = os.environ.get("MUSHI_API_ENDPOINT", "")
API_KEY    = os.environ.get("MUSHI_API_KEY", "")
PROJECT_ID = os.environ.get("MUSHI_PROJECT_ID", "")
GRAPH_NODE_UUID = os.environ.get("MUSHI_GRAPH_NODE_UUID", "")

if not (API_KEY and ENDPOINT and PROJECT_ID):
    sys.exit(
        "Missing config. Set MUSHI_API_KEY, MUSHI_API_ENDPOINT, and "
        "MUSHI_PROJECT_ID in the environment before running this script."
    )

ENV = {
    **os.environ,
    "MUSHI_API_ENDPOINT": ENDPOINT,
    "MUSHI_API_KEY": API_KEY,
    "MUSHI_PROJECT_ID": PROJECT_ID,
    "MUSHI_FEATURES": "triage,fixes,inventory,setup,docs",
}

proc = None
_id_counter = 0

def start_server():
    global proc
    proc = subprocess.Popen(
        ["node", MCP_BIN],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=ENV,
        text=True,
        encoding="utf-8",
        bufsize=1,
    )
    def drain_stderr():
        for _ in proc.stderr:
            pass
    threading.Thread(target=drain_stderr, daemon=True).start()

def rpc(method, params=None):
    global _id_counter
    _id_counter += 1
    req = {"jsonrpc": "2.0", "id": _id_counter, "method": method}
    if params is not None:
        req["params"] = params
    proc.stdin.write(json.dumps(req) + "\n")
    proc.stdin.flush()
    deadline = time.time() + 25
    while time.time() < deadline:
        out = proc.stdout.readline()
        if not out:
            time.sleep(0.05)
            continue
        out = out.strip()
        if not out:
            continue
        try:
            msg = json.loads(out)
        except json.JSONDecodeError:
            continue
        if msg.get("id") == _id_counter:
            return msg
    return None

ERROR_PREFIXES = (
    "[INSUFFICIENT_SCOPE]",
    "[INVALID_TOKEN]",
    "[UNAUTHORIZED]",
    "[HTTP_4",
    "[HTTP_5",
    "MCP error -32602",
    "MCP error -32603",
    "not found",
    "error",
)

def is_error_text(text: str) -> bool:
    tl = text.lower().strip()
    for p in ERROR_PREFIXES:
        if tl.startswith(p.lower()):
            return True
    # Also treat JSON containing {"ok":false} or {"error": ...} as error
    if tl.startswith("{"):
        try:
            d = json.loads(text.strip())
            if isinstance(d, dict):
                if d.get("ok") is False or "error" in d:
                    return True
        except Exception:
            pass
    return False

def call_tool(name, args=None):
    params = {"name": name, "arguments": args if args is not None else {}}
    resp = rpc("tools/call", params)
    if resp is None:
        return None, "TIMEOUT"
    if "error" in resp:
        return None, f"JSON-RPC error {resp['error'].get('code')}: {resp['error'].get('message','')}"
    content = resp.get("result", {}).get("content", [])
    text = " | ".join(c.get("text", "") for c in content if c.get("type") == "text")
    return text, None

# ANSI colours
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

results = []

def test(name, args=None, skip_reason=None, *, mutation=False, expect_error=False):
    tag = f"{CYAN}[W]{RESET} " if mutation else "    "
    if skip_reason:
        results.append(("SKIP", name, skip_reason))
        print(f"  {YELLOW}SKIP{RESET} {tag}{name:<42} {skip_reason}")
        return None

    text, err = call_tool(name, args)
    summary = (text or "")[:120]

    if err:
        results.append(("FAIL", name, str(err)[:120]))
        print(f"  {RED}FAIL{RESET} {tag}{name:<42} {str(err)[:100]}")
        return None

    # Classify content-level errors
    is_err = is_error_text(text or "")
    if is_err and not expect_error:
        results.append(("FAIL", name, summary))
        print(f"  {RED}FAIL{RESET} {tag}{name:<42} {summary[:100]}")
        return None

    results.append(("PASS", name, summary))
    print(f"  {GREEN}PASS{RESET} {tag}{name:<42} {summary[:100]}")
    return text


# ─── Bootstrap ───────────────────────────────────────────────────────────────
print(f"\n{BOLD}=== Mushi MCP -- yen-yen project full test ==={RESET}")
print(f"  endpoint  : {ENDPOINT}")
print(f"  project   : {PROJECT_ID}")
print(f"  key       : {API_KEY[:12]}...{API_KEY[-4:]}  (scopes: mcp:read, mcp:write)")
print()

start_server()

init_resp = rpc("initialize", {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "yenyen-test-runner", "version": "1.0"},
})
rpc("notifications/initialized")
tools_resp = rpc("tools/list")
tool_count = len(tools_resp.get("result", {}).get("tools", [])) if tools_resp else 0
print(f"  Server initialised  |  {tool_count} tools listed\n")


# ─── Phase 1: Health & Connection ────────────────────────────────────────────
print(f"{BOLD}1. Health & Connection{RESET}")
test("diagnose_setup")
test("get_two_way_comms_health")


# ─── Phase 2: Reports ────────────────────────────────────────────────────────
print(f"\n{BOLD}2. Reports -- list & search{RESET}")
reports_raw = test("get_recent_reports", {"limit": 5})
test("get_recent_reports", {"status": "new", "limit": 3})
test("search_reports", {"query": "crash login"})
test("get_similar_bugs", {"query": "null pointer on launch", "limit": 3})

report_id = None
fix_id    = None

if reports_raw:
    try:
        data = json.loads(reports_raw)
        reports = data.get("reports", [])
        if reports:
            report_id = reports[0]["id"]
            for r in reports:
                for fa in r.get("fix_attempts", []):
                    if fa.get("id"):
                        fix_id = fa["id"]
                        break
                if fix_id:
                    break
        print(f"  --> report_id = {report_id}")
        if fix_id:
            print(f"  --> fix_id    = {fix_id}")
    except Exception as e:
        print(f"  (could not parse reports: {e})")


# ─── Phase 3: Report detail ──────────────────────────────────────────────────
print(f"\n{BOLD}3. Report detail & evidence{RESET}")
if report_id:
    test("get_report_detail",    {"reportId": report_id})
    test("get_report_evidence",  {"report_id": report_id})
    test("get_report_timeline",  {"reportId": report_id})
    test("get_fix_context",      {"reportId": report_id})
    test("triage_issue",         {"report_id": report_id, "include_logs": False})
    test("suggest_fix",          {"reportId": report_id})
else:
    for t in ["get_report_detail","get_report_evidence","get_report_timeline",
              "get_fix_context","triage_issue","suggest_fix"]:
        test(t, skip_reason="no reports in yen-yen project yet")


# ─── Phase 4: Fix lifecycle (read-only) ──────────────────────────────────────
print(f"\n{BOLD}4. Fix lifecycle (read-only){RESET}")
if fix_id:
    test("get_fix_timeline", {"fixId": fix_id})
    test("refresh_ci",       {"fixId": fix_id}, mutation=True)
else:
    test("get_fix_timeline", skip_reason="no fix IDs available")
    test("refresh_ci",       skip_reason="no fix IDs available")
test("trigger_judge",        {"limit": 2}, mutation=True)


# ─── Phase 5: Mutation tools (skip in test run) ───────────────────────────────
print(f"\n{BOLD}5. Write / mutation tools (flagged -- not auto-executed){RESET}")
for name, reason in [
    ("dispatch_fix",        "would open a GitHub PR"),
    ("merge_fix",           "would squash-merge a PR"),
    ("submit_fix_result",   "would create a fix result row"),
    ("reopen_report",       "would mutate report status"),
    ("reply_to_reporter",   "would send message to a user"),
    ("transition_status",   "would mutate report status"),
    ("test_gen_from_report","would open a Playwright test PR"),
]:
    test(name, skip_reason=f"intentionally skipped -- {reason}")


# ─── Phase 6: Learning & Docs ────────────────────────────────────────────────
print(f"\n{BOLD}6. Learning & Docs{RESET}")
test("list_lessons",      {"limit": 3})
test("query_lessons",     {"diff_text": "const x = null;\nx.foo()", "top_k": 3})
test("search_mushi_docs", {"query": "MCP configuration"})
test("search_mushi_docs", {"query": "account key org-scoped"})
test("run_nl_query",      {"question": "How many open reports are there?"})


# ─── Phase 7: Codebase intelligence ─────────────────────────────────────────
print(f"\n{BOLD}7. Codebase intelligence{RESET}")
test("get_codebase_tour",       {"project_id": PROJECT_ID})
test("get_codebase_domains",    {"project_id": PROJECT_ID})
test("ask_codebase",            {"question": "What is the main entry point of the mobile app?",
                                 "project_id": PROJECT_ID})
test("search_codebase",         {"query": "transaction list", "project_id": PROJECT_ID})
test("get_file_summary",        {"file_path": "apps/mobile/app/(tabs)/index.tsx",
                                 "project_id": PROJECT_ID})
test("analyze_codebase_impact", {"project_id": PROJECT_ID, "source": "last_push"})
test("analyze_wiki_knowledge",  {"project_id": PROJECT_ID})


# ─── Phase 8: Graph & Knowledge ──────────────────────────────────────────────
print(f"\n{BOLD}8. Graph / Knowledge{RESET}")
# nodeId must be a graph_nodes UUID, not a file path
test("get_knowledge_graph", {"seed": GRAPH_NODE_UUID, "depth": 1})
test("get_graph_neighborhood", {"seed": GRAPH_NODE_UUID, "depth": 1})
test("get_graph_node",      {"nodeId": GRAPH_NODE_UUID})
test("get_blast_radius",    {"nodeId": GRAPH_NODE_UUID})


# ─── Phase 9: Inventory ──────────────────────────────────────────────────────
print(f"\n{BOLD}9. Inventory{RESET}")
test("get_inventory",      {"projectId": PROJECT_ID})
test("list_gate_findings", {"projectId": PROJECT_ID})
test("diff_inventory",     skip_reason="requires specific fromSha/toSha from CI")


# ─── Phase 10: Setup (read probe only) ───────────────────────────────────────
print(f"\n{BOLD}10. Setup & Docs{RESET}")
test("setup_repo_for_mushi", skip_reason="would mutate repo settings -- manual step")


# ─── Summary ─────────────────────────────────────────────────────────────────
proc.stdin.close()
proc.terminate()

passed  = [r for r in results if r[0] == "PASS"]
failed  = [r for r in results if r[0] == "FAIL"]
skipped = [r for r in results if r[0] == "SKIP"]

print(f"\n{BOLD}--- Results ---{RESET}")
print(f"  PASS   {len(passed):2d}")
print(f"  FAIL   {len(failed):2d}")
print(f"  SKIP   {len(skipped):2d}")
print(f"  Total  {len(results):2d}  (of {tool_count} tools)")

if failed:
    print(f"\n{BOLD}Failures:{RESET}")
    for _, name, err in failed:
        print(f"  FAIL  {name}: {err[:160]}")

if skipped:
    print(f"\n{BOLD}Skipped (intentional):{RESET}")
    for _, name, reason in skipped:
        print(f"  SKIP  {name}: {reason}")

sys.exit(0 if not failed else 1)
