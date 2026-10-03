{{/*
FILE: _helpers.tpl
PURPOSE: Shared helpers for the chart.

mushi.migrationShards: the sorted list of migration shard keys, one per
calendar month (the first 6 digits of each migration's timestamp, YYYYMM),
as a comma-separated string. A single ConfigMap is capped at 1 MiB by the
Kubernetes API, and the full migration set passed that in 2026, so
configmap-migrations.yaml writes one ConfigMap per month and job-migrate.yaml
mounts them all into one directory. Both templates call this helper so the
two lists can never disagree.
*/}}
{{- define "mushi.migrationShards" -}}
{{- $shards := dict -}}
{{- range $path, $_ := .Files.Glob "migrations/*.sql" -}}
{{- $_ := set $shards (substr 0 6 (base $path)) true -}}
{{- end -}}
{{- keys $shards | sortAlpha | join "," -}}
{{- end -}}
