# Masar CLI

Find and rank B2B leads in the Middle East from your terminal, with **your own AI**:
Claude (your Pro or Max plan through Claude Code, or an API key), ChatGPT/Codex (your ChatGPT plan through the Codex CLI, or an OpenAI API key), or a local model (Ollama, LM Studio, llama.cpp, vLLM).

You sign in with your Masar account. Every lead you save goes to your Masar dashboard and uses your plan's credits.

## Install

Needs Node.js 20.3 or newer.

```sh
npm install -g https://masar-umber-two.vercel.app/cli/masar-cli.tgz
masar login
masar find
```

## Commands

| Command | What it does |
|---|---|
| `masar login` | Shows a code and opens the Masar website; approve it there to connect this computer to your account. |
| `masar ai` | Choose the AI the agents use. `masar ai test` checks it works. |
| `masar find` | The Boss agent asks a few questions, plans the search, and runs the agents. |
| `masar find "coffee beans to cafes in Amman"` | Start the conversation with what you need. |
| `masar status` | Your plan, credits and AI. |
| `masar open` | Opens your dashboard. |
| `masar doctor` | Checks the website, your sign-in, your AI and which official APIs are connected. |
| `masar logout` | Signs this computer out. You can also sign computers out from `/cli/connect` on the website. |

Skip the questions: `masar find --city "Riyadh, Jeddah" --industry clinics --offer "Laser devices" --count 20 --agents google_web,website,linkedin -y`

Options: `--out leads.csv`, `--json`, `--no-save` (don't save to the dashboard), `--no-websites` (don't read business websites), `--no-browser`, `--model <name>`, `--url <local server>`.

## The agents

The CLI runs the same seven agents as the website (the shared code in `src/core`); see `docs/agents.md` in the repository.

1. **Boss** talks with you, understands who you sell to, picks the collectors, runs them side by side with a time limit each, and keeps going when one fails.
2. **LinkedIn collector** confirms LinkedIn company pages through LinkedIn's official API, when you connect it. LinkedIn has no API to search companies, so it never finds new ones.
3. **Instagram collector** checks Instagram business accounts through Instagram's official Business Discovery API, when you connect it. It cannot search by keyword or city.
4. **Facebook collector** searches Facebook Pages through Meta's official Pages Search API, when you connect it.
5. **Google & web collector** finds businesses on Google Maps (Places API, with a key), OpenStreetMap and your AI's own web search, then reads each business's website (following robots.txt) and public search results for contacts and profiles.
6. **Connector** is your AI: Claude Code, Codex, an API key or a local model.
7. **Intelligence** removes duplicates, scores how much is verified and how well each lead fits your need, ranks them (40% fit, 30% compatibility, 30% verified), and saves them to your dashboard, filed by category.

`masar find` ends with one line per agent saying what it did, or why it was off (`disabled`: not connected; `unsupported`: the platform offers no authorized way).

## Plans and credits

| Plan | CLI leads |
|---|---|
| Free | 10 credits, once |
| Basic | 300 credits a month, 1 per saved lead |
| Premium | Free |

## Your AI, your account

Masar starts your AI on this computer, signed in as you, for your own searches. It never sends your AI login or API keys to Masar, and it never shares one person's subscription with anyone else. Use each AI under its own terms.

The agents use official APIs, public pages and public search results only. They never open or sign in to Instagram, Facebook or LinkedIn pages, never get past a login wall or captcha, and never collect personal phone numbers or emails. With a local model (no web search), you get map and website data plus the official API checks you connect.

## Settings

Saved in `~/.config/masar/config.json` (Windows: `%APPDATA%\masar\config.json`), readable only by you.

| Variable | Use |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Your own API keys, if you use them. |
| `OLLAMA_HOST` | Ollama address (default `http://127.0.0.1:11434`). |
| `GOOGLE_MAPS_API_KEY` | Your Google Places API (New) key, for Google Maps results. |
| `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Turn on the Instagram collector (see `docs/agents.md`). |
| `FACEBOOK_APP_ACCESS_TOKEN` | Turn on the Facebook collector. |
| `LINKEDIN_ACCESS_TOKEN` | Turn on the LinkedIn collector. |
| `MASAR_URL` | A different Masar site (for testing). |
| `MASAR_THEME=light` | Colours for light terminals. `NO_COLOR=1` turns colours off. |
| `MASAR_REDUCED_MOTION=1` | No animation. |

## Building

`npm run build` on the website builds this package first and serves it at `/cli/masar-cli.tgz`. To build only the CLI: `npm run cli:pack` from the repository root.
