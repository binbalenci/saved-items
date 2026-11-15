# Contract: Bot replies

The bot's only interface this feature changes is the reply to a message containing links.
Telegram HTML parse mode; every piece of page or model text MUST go through `escapeHtml`.
The webhook endpoint, its secret header and the owner-only check are unchanged.

## Shape

One message (split with `chunk()` if over 4,000 characters), replying to the user's message,
link previews off. One block per link, in message order, separated by a blank line. At most
10 links; later ones are ignored as today.

**Naming the link**: the title line of every block is `<b>Title</b>`, or the escaped URL when
there is no title. This holds for Full, Partial, Known and Unread blocks.

## Blocks

**Full** (FR-002, FR-003): title, snippet cut to 160 characters in the reply (the stored
snippet keeps up to 400), tags.

```text
✓ <b>How Workers AI prices neurons</b>
Cloudflare explains how model usage maps to neurons and what the free allowance covers…
#workers-ai #pricing
```

**Partial** (FR-016): shows what was found and names exactly what is missing, in the form
`Couldn't get <list>; the daily fill-in will add what's missing.`

```text
◐ <b>How Workers AI prices neurons</b>
Cloudflare explains how model usage maps to neurons…
Couldn't get tags; the daily fill-in will add what's missing.
```

The list names only the missing parts:

| Missing | Line |
|---|---|
| tags | `Couldn't get tags; …` |
| snippet | `Couldn't get a snippet; …` |
| snippet and tags | `Couldn't get a snippet and tags; …` |
| title | `Couldn't get a title; …` |
| title and tags | `Couldn't get a title and tags; …` |
| title and snippet | `Couldn't get a title and a snippet; …` |

**Unread** (FR-008, FR-009): never shows an invented snippet or tags. States the reason in
plain words. The second line is the title if one was found, otherwise the URL.

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

**Save failed** (FR-001, SC-002): shown only if saving that link raised an error. The link is
not read.

```text
⚠ I couldn't save this one, please send it again.
https://example.com/…
```

## Unchanged

`/find`, `/help`, the "Send me a link to save" reply, the "Not set up yet" reply and silence
for any other user.
