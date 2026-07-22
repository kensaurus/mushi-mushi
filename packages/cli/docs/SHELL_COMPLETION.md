# Shell completion

The `mushi` CLI ships a completion-script generator. `mushi completion <shell>`
prints a script built from the **live command tree**, so it never drifts from
the real subcommand list.

Supported shells: **bash**, **zsh**, **fish**. (PowerShell is covered by a
manual snippet at the bottom.)

---

## Quick try (current shell only)

```bash
# bash / zsh
eval "$(mushi completion bash)"     # or: zsh
```

This lasts until you close the terminal. To persist, use a section below.

---

## bash

Append the script to your `~/.bashrc` (or `~/.bash_profile` on macOS):

```bash
mushi completion bash >> ~/.bashrc
# reload:
source ~/.bashrc
```

Completions require the `bash-completion` package. On macOS:

```bash
brew install bash-completion@2
```

## zsh

Completions must live in a directory on your `$fpath`. Write the script there
with the required `_mushi` filename, then reload `compinit`:

```zsh
# pick the first writable dir already on $fpath:
mushi completion zsh > "${fpath[1]}/_mushi"
# then, once, ensure compinit runs (usually already in ~/.zshrc):
autoload -Uz compinit && compinit
```

If you use a framework:

- **Oh My Zsh**: `mushi completion zsh > ~/.oh-my-zsh/completions/_mushi`
  (create the dir if missing: `mkdir -p ~/.oh-my-zsh/completions`).
- **Prezto / manual**: any dir added via `fpath+=(...)` before `compinit`.

## fish

fish auto-loads completions from `~/.config/fish/completions/`:

```fish
mushi completion fish > ~/.config/fish/completions/mushi.fish
```

No reload needed — open a new shell or run `exec fish`.

---

## PowerShell (manual)

The generator does not yet emit a PowerShell script. Until it does, register a
lightweight argument completer in your profile
(`$PROFILE` → e.g. `Documents\PowerShell\Microsoft.PowerShell_profile.ps1`):

```powershell
Register-ArgumentCompleter -Native -CommandName mushi -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    @(
        'login','logout','init','reports','feedback','lessons','project',
        'setup','fix','nudge','upgrade','connect','doctor','reset','tdd',
        'keys','integrations','qa','audit','skills','billing','selfhost',
        'completion','profile'
    ) | Where-Object { $_ -like "$wordToComplete*" } |
        ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
```

Reload with `. $PROFILE`.

---

## Notes

- Regenerate the script after upgrading the CLI (`mushi upgrade --self`) so new
  subcommands complete — the bash/zsh/fish scripts are static snapshots of the
  command tree at generation time.
- CI environments never need completion; skip this there.
