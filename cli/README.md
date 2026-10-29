# Masar CLI

Find and rank B2B leads in the Middle East from your terminal, with **your own AI**:
Claude (your Pro or Max plan through Claude Code, or an API key), ChatGPT/Codex (your ChatGPT plan through the Codex CLI, or an OpenAI API key), or a local model (Ollama, LM Studio, llama.cpp, vLLM).

You sign in with your Masar account. Every lead you save goes to your Masar dashboard and uses your plan's credits.

## Install

Needs Node.js 18.17 or newer.

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
| `masar find` | The main agent asks a few questions, plans the search, and runs the agents. |
| `masar find "coffee beans to cafes in Amman"` | Start the conversation with what you need. |
| `masar status` | Your plan, credits and AI. |
| `masar open` | Opens your dashboard. |
| `masar doctor` | Checks the website, your sign-in and your AI. |
| `masar logout` | Signs this computer out. You can also sign computers out from `/cli/connect` on the website. |

Skip the questions: `masar find --city "Riyadh, Jeddah" --industry clinics --offer "Laser devices" --count 20 --agents google,website,linkedin -y`

Options: `--out leads.csv`, `--json`, `--no-save` (don't save to the dashboard), `--no-browser`, `--model <name>`, `--url <local server>`.

## The agents

1. **Main agent** talks with you, understands who you sell to, and picks the pipeline (which agents to send and what to look for).
2. **Google agent** finds businesses on OpenStreetMap and, when your AI can search the web, in Google Maps listings, Google results and local directories (through your AI's own search tool).
3. **Website agent** reads each business's own website for emails, phones and social links. It follows robots.txt.
4. **Instagram, Facebook and LinkedIn agents** check each business's public profiles and find decision makers' public job titles, from public search results only.
5. **Documenter** gathers everything, scores how much is verified and how well each lead fits your need, ranks them (40% fit, 30% compatibility, 30% verified) and shows you the list. It saves a CSV that opens in Excel and Google Sheets.

## Plans and credits

| Plan | CLI leads |
|---|---|
| Free | 10 credits, once |
| Basic | 300 credits a month, 1 per saved lead |
| Premium | Free |

## Your AI, your account

Masar starts your AI on this computer, signed in as you, for your own searches. It never sends your AI login or API keys to Masar, and it never shares one person's subscription with anyone else. Use each AI under its own terms.

The agents use public pages and public search results only. They never sign in to Instagram, Facebook, LinkedIn or Google, never get past a login wall or captcha, and never collect personal phone numbers or emails. With a local model (no web search), the social agents keep only the links each business published on its own website or map listing.

## Settings

Saved in `~/.config/masar/config.json` (Windows: `%APPDATA%\masar\config.json`), readable only by you.

| Variable | Use |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Your own API keys, if you use them. |
| `OLLAMA_HOST` | Ollama address (default `http://127.0.0.1:11434`). |
| `MASAR_URL` | A different Masar site (for testing). |
| `MASAR_THEME=light` | Colours for light terminals. `NO_COLOR=1` turns colours off. |
| `MASAR_REDUCED_MOTION=1` | No animation. |

## Building

`npm run build` on the website builds this package first and serves it at `/cli/masar-cli.tgz`. To build only the CLI: `npm run cli:pack` from the repository root.
