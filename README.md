# JADE LENS

<p align="center">
  <img src="./assets/logo/inkscape-logo.no-bg.opt.svg" alt="JADE LENS logo" width="400">
</p>

_**J**enuinely **A**daptive, ri**D**iculously v**E**rsati**LE** i**N**tellect **S**idekick._

## What is it?

JADE LENS is an AI assistant (framework) for personal organization. You give it chaotic, unsorted information, and it figures out how to store it in a structured way for easy access later. You go from "planning next year's vacation" to "journaling a weird dream you had last night" to "remind me to buy milk this afternoon", let your thoughts flow randomly the way they do, and Jade figures out how to organize them. Later, you can browse your beautifully sorted notes, and Jade can also help you navigate and understand them. Most importantly, the structure of the data is designed specifically for you, and it evolves over time to fit your needs.

Three pieces work together:

- **The assistant** — a command-line tool plus an agentic skill (e.g. for Claude Code). This is where you *talk* to JADE LENS: you tell it things ("met with Sam about the lease, follow up next Tuesday") and ask it things ("what's still open on the kitchen project?"), and it files everything away and keeps it tidy.
- **The web app** — a browser app (also installable on your phone) for *seeing and manually editing* your data directly: browse projects and notes, tick off a task, fix a value — without going through the assistant.
- **Your data repo** — a private GitHub repository holding everything as plain JSON and Markdown files. It's *your* data, in *your* repo, in a format you can read, edit, and take with you. Nothing is locked inside JADE LENS.

> The assistant lives in Claude Code today (desktop, mobile, and the web). Chatting with it *inside* the web app is on the roadmap — for now the web app is the window for viewing and manually editing.

## Getting started

You'll need a **[GitHub account](https://github.com/)**, **[Claude Code](https://code.claude.com/docs)**, and **[uv](https://docs.astral.sh/uv/)** (plus `git`) on the machine where you'll run the assistant.

1. **Install the `jadelens` CLI tool:**

```bash
uv tool install "git+https://github.com/tomasssalles/jade-lens.git@cli-latest"
```

2. **Create your data repo:** Create a new **private** GitHub repository for your personal data. Do not add any files to the repository yet (no README, no LICENSE, no .gitignore, nada). Your repository will have no commits at this point. Make sure you've **[registered an SSH key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh)** from the computer you're using in your GitHub account
3. **Clone and prepare the data repo:** Run the initialization script to
    - Interactively configure your assistant (e.g. assistant name == agentic skill `/<assistant-name>`, default is `/jade`).
    - Clone the data repo.
    - Create the required initial data files and commit them.
    - Create the skill file for the agent (inside the repo, gitignored).
    - Symlink the skill to your home so it's accessible from any session (not only sessions started from the data repo).

```bash
jadelens init /path/where/to/clone/data-repo
```

4. **Try out the assistant:** Start a `claude` session anywhere and type `/<assistant-name> <your-prompt>` (the name you chose during initialization). Try using your first few interactions to ask the assistant how you can interact with it and what it can do for you. Later you can enter your notes using natural language, e.g. `/jade I just got fired. New project: job search. Second new project: Develop awesome AI assistant tool now that I have some time in my hands.`. You can look at your data directly in the data repo you created on GitHub, but that's not the most user-friendly experience. Which brings us to...
5. **Open the web app:** Go to **https://tomasssalles.github.io/jade-lens/**. On your first visit, the main page will let you set up access to your data repo. You'll need a **GitHub personal access token (PAT)** (fine-grained is safest, scoped to the data repo only) so the app can read and write your data. (If you don't trust Jade yet, a read-only PAT will also work, but obviously only for visualizing the data.)
6. **Install it on your phone (optional).** Open the app in the browser (**Chrome** is recommended at least on Android) and choose **Add to Home screen** (and if asked, choose "install" instead of "open in the browser") for an app-like, full-screen launcher with a pretty icon and all (a PWA).

## Security & privacy

JADE LENS is built to keep your data yours, and to keep the amount of trust you have to place in me (the developer) as small as possible:

- **The code is public** — Anyone can read exactly what it does. If you don't code, ask your favorite AI to go over [the repository](https://github.com/tomasssalles/jade-lens) and analyse how safe it is.
- **There's no JADE LENS backend** — Nothing runs on a server I operate; the web app is a static site on GitHub Pages that talks directly to *your* GitHub repo from *your* browser.
- **Your data lives in your own private GitHub repo** — Under your account, not mine.
- **Secrets stay on your device** — Your access token is stored locally in your browser and is only ever sent to GitHub.
- **You set up the AI** — The bot that sees your data runs through your own Claude Code, configured by you.

**The honest wrinkle — the PAT** Obviously, if my GitHub account is hacked and the attacker replaces my code with malicious code and deploys it as the new version of the app, they'll have access to the PAT stored in your browser and therefore to your personal data. In fact, access to the stored PAT is restricted to the host `tomasssalles.github.io`, which means that even if the hacker doesn't touch the `jade-lens` repo but instead creates a new repository, deploys it to GitHub pages (which will be under the same host) and gets you to visit that site, they'll have access to the PAT stored by Jade. There's not much I can do in this regard other than using a very strong password for my account and trusting GitHub to take their security seriously. What you can do to reduce the risk for your personal data is:

- Inform yourself about how to quickly **revoke your PAT** on GitHub if you're ever suspicious.
- Use **short-lived PATs** that you re-generate regularly (at the cost of convenience).

**Planned hardening** (things we intend to build):

- **A project-specific host**, so the data and the PAT are only accessible specifically to the Jade Lens app and this class of risk shrinks.
- **Encrypting the PAT** before storing it, behind a key only you hold (a password, fingerprint, etc).
- **An app lock**, so your data isn't exposed if someone gets hold of your device while it's unlocked.

## On the roadmap: Chatting with your assistant inside the web app

A chat interface inside the web app is planned, so Claude Code isn't required to talk to it. This should also widely open up the choice of AI (provider and model) for you, so you'll be able to use Claude, ChatGPT, Gemini and others.

## Issues & feedback

Found a bug or have an idea? You're very welcome to [open an issue on GitHub](https://github.com/tomasssalles/jade-lens/issues).

## For developers

Project documentation lives in [`docs/`](./docs). Start with [`docs/README.md`](./docs/README.md), which explains how the documentation is organised.

## License

**Software Code:** The code in this repository is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE.md). You are free to read, modify, and use this code for personal or non-commercial purposes. Commercial use is strictly prohibited.

**Branding / Assets:** The logo and associated visual assets (located in `assets/`) are licensed under [Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/).
