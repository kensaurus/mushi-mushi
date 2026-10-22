---
'@mushi-mushi/mcp': minor
---

New read tool `get_ci_costs` (ADR 0037): what a project's CI costs and how fast it runs on GitHub-hosted runners versus your own machines. It returns rows per repo and runner class (wait and run times, pull-request pass rate, minutes billed, an estimated monthly cost), included minutes per GitHub account, your machines' busy time and electricity, speed factors measured only from jobs that passed on both, what-ifs for moving a workflow, the reasons behind each cost, and advice. Wait and run times are measured; money is always an estimate, with the date of GitHub's price list. Read-only, and wrapped as untrusted data because repo, workflow and job names come from the repos.
