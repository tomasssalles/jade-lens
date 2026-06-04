# JADE LENS

<p align="center">
  <img src="./assets/logo/inkscape-logo.no-bg.opt.svg" alt="JADE LENS logo" width="400">
</p>

_**J**enuinely **A**daptive, ri**D**iculously v**E**rsati**LE** i**N**tellect **S**idekick._

## What is it?

JADE LENS is a personal AI assistant for the messy parts of daily life — your calendar, tasks, projects, notes, plans, research, and preferences. You talk to it in plain language; it turns that chaos into well-organised, structured data and answers questions across all of it.

It's three pieces working together:

- **The assistant** — a command-line tool plus a Claude Code skill. This is where you *talk* to JADE LENS: you tell it things ("met with Sam about the lease, follow up next Tuesday") and ask it things ("what's still open on the kitchen project?"), and it files everything away and keeps it tidy.
- **The web app** — a browser app (also installable on your phone) for *seeing and editing* your data directly: browse projects and notes, tick off a task, fix a value — without going through the assistant.
- **Your data repo** — a private GitHub repository holding everything as plain JSON and Markdown files. It's *your* data, in *your* repo, in a format you can read, edit, and take with you. Nothing is locked inside JADE LENS.

> The assistant lives in Claude Code today (desktop, mobile, and the web). Chatting with it *inside* the web app is on the roadmap — for now the web app is the window for viewing and editing.

## Getting started

You'll need a **GitHub account**, **[Claude Code](https://code.claude.com/docs)**, and **[uv](https://docs.astral.sh/uv/)** (plus `git`) on the machine where you'll run the assistant.

> Today's setup is a little hands-on — a guided `jadelens init` is planned to smooth it out. Here's the gist; the full file-by-file walkthrough lives in [`docs/`](./docs).

1. **Create your data repo.** Make a new **private** GitHub repository for your data and clone it locally.
2. **Bootstrap it.** Add a small set of starter files (your name, your assistant's name, and a session-start hook). The exact contents are in the data-repo setup guide under [`docs/`](./docs).
3. **Start the assistant.** From the root of your data repo, run `claude`. On first run it installs the JADE LENS tooling and renders your skill automatically — you choose the assistant's name, and that becomes its slash command (e.g. `/jade`). Then just talk to it.
4. **Open the web app.** Go to **https://tomasssalles.github.io/jade-lens/**, open **Settings**, and point it at your data repo with a **GitHub personal access token (PAT)** scoped to that repo so it can read and write your data.
5. **Install it on your phone (optional).** Open the app in **Chrome** (recommended on Android) and choose **Add to Home screen** for an app-like, full-screen launcher (a PWA).

## Security & privacy

JADE LENS is built to keep your data yours, and to keep the amount of trust you have to place in me small:

- **The code is public** — anyone can read exactly what it does.
- **There's no JADE LENS backend.** Nothing runs on a server I operate; the web app is a static site on GitHub Pages that talks directly to *your* GitHub repo from *your* browser.
- **Your data lives in your own private GitHub repo** — under your account, not mine.
- **Secrets stay on your device.** Your access token is stored locally in your browser and is only ever sent to GitHub.
- **You set up the assistant.** The bot that sees your data runs through your own Claude Code, configured by you.

**The honest wrinkle — the PAT.** The web app is currently served from a shared `github.io` address. So if my GitHub account were compromised — an attacker swapping in malicious code, or publishing a malicious site to the *same* address — and you then visited it, that code could read the token your browser stored for that address and gain read/write access to your data repo. Two things keep this manageable today: you can **revoke the PAT** on GitHub at any moment (instantly cutting off access), and you can use **short-lived PATs** for extra safety, at a little cost in convenience.

**Planned hardening** (things we intend to build):

- **A project-specific domain**, so the app no longer shares an address with anything else and this whole class of risk shrinks.
- **Encrypting the PAT** before storing it, behind a key only you hold (a password, fingerprint, etc.).
- **An app lock**, so your data isn't exposed if someone gets hold of your device while it's unlocked.

## On the roadmap

A few things we're confident we'll build, beyond the security hardening above:

- **Chatting with your assistant inside the web app**, so Claude Code isn't required to talk to it.
- **One-command setup** (`jadelens init`) for the data repo.

## Issues & feedback

Found a bug or have an idea? You're very welcome to [open an issue on GitHub](https://github.com/tomasssalles/jade-lens/issues).

## For developers

Project documentation lives in [`docs/`](./docs). Start with [`docs/README.md`](./docs/README.md), which explains how the documentation is organised.

## License

**Software Code:** The code in this repository is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE.md). You are free to read, modify, and use this code for personal or non-commercial purposes. Commercial use is strictly prohibited.

**Branding / Assets:** The logo and associated visual assets (located in `assets/`) are licensed under [Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/). 
