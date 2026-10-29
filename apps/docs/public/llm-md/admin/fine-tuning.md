# Fine-tuning

Source: https://kensaur.us/mushi-mushi/docs/admin/fine-tuning

---
title: Fine-tuning
description: Fine-tuning jobs in Mushi Mushi export classified reports, train a small OpenAI or Bedrock model, validate it, and swap it in for the fast filter or diagnosis.
---

# Fine-tuning

**Where:** **AI prompts** (`/prompt-lab`) → **Advanced: fine-tuning & synthetic** →
**Fine-tuning jobs**. The old `/fine-tuning` link redirects to `/prompt-lab`; there is no
separate Fine-tuning page any more.

A fine-tuning job in Mushi Mushi exports your project's classified reports, trains a
fine-tuned model with a vendor, checks it against recent reports, and, if you promote it,
makes it the model for one classification step.

---

## Start a job

Click **New job** and choose:

| Field | Options |
| ----- | ------- |
| **Vendor / base model** | **OpenAI — gpt-4o-mini (self-service)**, the default, or **Bedrock — Claude 3 Haiku (requires AWS setup)** |
| **Promote to stage** | `stage1` (fast filter) or `stage2` (diagnosis). Type it exactly. |

Bedrock training is off unless the server sets `MUSHI_BEDROCK_FINETUNE_ENABLED=1` and
`BEDROCK_OUTPUT_S3_URI`, and the project has AWS credentials as a BYOK key.

---

## Job steps

Each job row has a button for its next step:

1. **Export training samples.** Mushi gathers classified reports from the job's time
   window with a confidence of at least 0.85 (the default), skipping dismissed reports.
   When the job asks for judge-confirmed labels only, it keeps reports the grader agreed
   with.
2. **Upload and start training.** The samples go to the vendor and a training job starts.
3. **Check status.** Asks the vendor whether training has finished. OpenAI can also
   report back through a webhook.
4. **Validate.** Runs the model on up to 500 recent classified reports. It passes when
   accuracy is at least 85%, the drift score is at most 0.25, and no training data leaked
   into the check.
5. **Promote.** Only a validated job can be promoted. It sets the project's fine-tuned
   model for the chosen stage (`stage1` or `stage2`) and writes an audit event.

**Reject** asks for a short reason (at least 4 characters) and records it. **Delete**
removes the job.

The table shows **Status**, **Model**, **Promote to**, **Samples**, **Accuracy**,
**Created** and the actions.

---

## See also

- [AI prompts](/admin/prompt-lab) — where this card lives, and where you A/B test prompts
- [Triage grading](/admin/judge) — the grader whose verdicts can filter training samples
- [Concepts → Judge & self-improvement](/concepts/judge-loop) — how grading and prompts fit together
