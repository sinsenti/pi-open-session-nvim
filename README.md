# Pi session → Neovim extension

`open-session-nvim.ts` adds a `/nvim` command and is installed globally at
`~/.pi/agent/extensions/open-session-nvim.ts`. It renders the latest request and
response as Markdown in `/tmp/pi-session-<session-id>.md`,
temporarily suspends Pi's TUI, and opens that file in `nvim`. The output is
intentionally minimal: it contains only `User` and `Assistant` text. Metadata,
timestamps, model details, thinking blocks, tool calls/results, and bash output
are omitted.

## Usage

The global extension is auto-discovered by Pi. Start Pi normally and use:

```text
/nvim          # latest request and its response
/nvim branch   # complete active branch
/nvim all      # full stored session, including alternate branches
```

`Ctrl+N` opens the latest request and response. `Ctrl+Shift+N` is reserved for the
session picker's named-session filter. The command can be run while Pi is
answering: the transcript includes the response text received so far. Pi's
TUI/model processing pauses while the foreground Neovim process is open; close
Neovim to return to Pi. The Markdown file is retained in `/tmp` after Neovim
exits and is written with mode `0600`.

To reinstall or update the global copy from this directory:

```bash
mkdir -p ~/.pi/agent/extensions
cp ./open-session-nvim.ts ~/.pi/agent/extensions/
```

Run `/reload` in Pi (or restart it) after updating. Neovim must be available on
`$PATH`.

## Install from a private Git repository

This directory includes a `package.json` Pi manifest, so it can be installed
from a private Git repository with `pi install git:...`. The package points to
`open-session-nvim.ts` and has no build step.

```bash
git init -b main
git add open-session-nvim.ts package.json README.md
git commit -m "Add Pi session Neovim extension"

# After creating a private GitHub repository and authenticating with SSH:
git remote add origin git@github.com:YOUR_USER/pi-open-session-nvim.git
git push -u origin main

# Install globally in Pi:
pi install git:git@github.com:YOUR_USER/pi-open-session-nvim
```

After installing the Git package, remove the manually copied extension to avoid
loading it twice:

```bash
rm ~/.pi/agent/extensions/open-session-nvim.ts
```

Then run `/reload` or restart Pi. Keep the Git package in your global settings;
future commits can be picked up with `pi update --extensions` or by reinstalling
the Git source at the desired ref.

## Existing related extensions

- `pi-markdown-preview` (already installed in this Pi setup) previews the latest
  response or local Markdown, but does not export the whole session to Neovim.
- [`pi-md-export`](https://pi.dev/packages/pi-md-export) already exports a
  branch or the full session with `/md` and `/md all`, but does not open Neovim.
- [`byteowlz/pi-agent-extensions`](https://github.com/byteowlz/pi-agent-extensions)
  has a similar `/export-md` extension.
- [`carderne/pi-nvim`](https://github.com/carderne/pi-nvim) bridges a running Pi
  session and Neovim for sending prompts/context; it is not a transcript viewer.
- [`anuragrao04/pi-coding-agent.nvim`](https://github.com/anuragrao04/pi-coding-agent.nvim)
  embeds Pi in a Neovim terminal and provides session commands.

Pi extensions are TypeScript modules with a default factory receiving
`ExtensionAPI`. They can live in `~/.pi/agent/extensions/` or
`.pi/extensions/`, and commands are registered with `pi.registerCommand()`.
The implementation follows Pi's `interactive-shell.ts` pattern to stop the TUI
while an interactive terminal program runs.
