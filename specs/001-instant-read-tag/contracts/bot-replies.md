# Contract: Bot replies

The bot's only interface this feature changes is the reply to a message containing links.
Telegram HTML parse mode; every piece of page or model text MUST go through `escapeHtml`.
The webhook endpoint, its secret header and the owner-only check are unchanged.

## Shape

One message (split with `chunk()` if over 4,000 characters), replying to the user's message,
link previews off. One block per link, in message order, separated by a blank line. At most
10 links; later ones are ignored as today.

## Blocks

**Full** (FR-002, FR-003): title, snippet cut to 160 characters in the reply (the stored
snippet keeps up to 400), tags.

```text
✓ <b>How Workers AI prices neurons</b>
Cloudflare explains how model usage maps to neurons and what the free allowance covers…
#workers-ai #pricing
```

**Partial** (FR-016): shows what was found and names what is missing.

```text
◐ <b>How Workers AI prices neurons</b>
Cloudflare explains how model usage maps to neurons…
Couldn't make tags, the daily fill-in will add them.
```

**Unread** (FR-008, FR-009): never shows an invented snippet or tags. States the reason in
plain words. Shows the URL when there is no title.

```text
⚠ Saved, but I couldn't read it (login wall). Your note is kept; the daily fill-in will try.
https://www.facebook.com/groups/…/posts/…
```

Reason wording: `login` → "login wall", `gone` → "the page is gone", `error` → "the site
returned an error", `timeout` → "it took too long", `empty` → "there was too little text",
`unsupported` → "it isn't a web page I can read".

**Known** (FR-012): the link was saved and fully read before; no fetch.

```text
Already saved: <b>How Workers AI prices neurons</b>
Cloudflare explains how model usage maps to neurons…
#workers-ai #pricing
```

If the message also carried a new note, the first line reads `Already saved, note added:`.
For a link saved before but not fully read, the bot reads it again and answers with the Full,
Partial or Unread block above, exactly as for a new link.

## Unchanged

`/find`, `/help`, the "Send me a link to save" reply, the "Not set up yet" reply and silence
for any other user.
