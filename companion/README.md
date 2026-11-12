# Kimoto Discord companion

Shows what you're reading in Kimoto on your Discord profile:

> **Reading Lanterns Over Kirihara**
> Ch. 3
> 24:13 elapsed

Browsers can't talk to the Discord desktop app directly, so this small program runs on your computer next to Discord. It listens on `ws://127.0.0.1:47123`, and the Kimoto web app sends it presence updates while you read.

## Setup

1. Create a Discord application at <https://discord.com/developers/applications> and copy its **Application ID**. You can optionally upload an image named `kimoto` under *Rich Presence → Art Assets*.
2. Make sure the Discord desktop app is running.
3. From the Kimoto repository root:

   ```bash
   DISCORD_CLIENT_ID=your_application_id npm run companion
   ```

4. In Kimoto, go to **Settings → Discord Rich Presence**, click **Test connection**, then turn it on.

## Options

| Variable | Default | Purpose |
|---|---|---|
| `DISCORD_CLIENT_ID` | — (required) | Your Discord application ID |
| `KIMOTO_ORIGINS` | `http://localhost:5173,http://localhost:4000` | Comma-separated web origins allowed to set your presence. Add your Kimoto URL if you self-host it elsewhere. |
| `KIMOTO_COMPANION_PORT` | `47123` | Local port. The web app expects 47123. |
| `DISCORD_LARGE_IMAGE` | `kimoto` | Art asset key shown on your profile |

## Privacy

- The companion only accepts connections from `127.0.0.1` and from the origins you allow.
- The web app applies your privacy choices *before* sending anything: hide the title, the chapter, or the reading duration.
- Presence clears automatically when you close the reader.
