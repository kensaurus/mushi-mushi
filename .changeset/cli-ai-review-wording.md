---
'@mushi-mushi/cli': patch
---

The CLI calls the pull request review "the AI review" instead of "the Opus review": a team that runs Mushi Mushi on OpenAI has its fixes reviewed by a GPT model, so "Opus" was wrong for them. Help text, `mushi work` prompts and its commit messages changed; commands and flags did not.
