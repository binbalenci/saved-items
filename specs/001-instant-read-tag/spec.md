# Feature Specification: Instant Read and Tag on Save

**Feature Branch**: `speckit-adoption`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: "When I share a link to my saves bot (usually from my phone's share sheet, sometimes with a note), the bot should read the page right away and reply with the title, a short snippet of what it's about, and 1–3 English tags, so I know it was understood without waiting for the next day's fill-in. If the page can't be read (login wall, removed post, error), the link is still saved with my note, the reply says it couldn't be read, and it is left for the daily fill-in. The daily fill-in then only fills in what is still missing. Out of scope: importing old saves, changing the Saved Items page, changing the Friday digest, editing tags from the chat."

## Clarifications

### Session 2026-11-15

- Q: When a page is read but only part of the details come out (e.g. title and snippet, no usable tags), keep and show what was found, or treat the whole link as unreadable? → A: Keep and show what was found, say what is missing, and leave the link for the daily fill-in to complete only the missing parts.
- Q: If I share a link I already saved, should the bot try reading the page again when the earlier attempt failed or only partly worked? → A: Yes. A link that was fully read is shown from what is saved and not read again; a link that was not fully read is read again now, filling in only what is missing.
- Q: When one message contains several links, should the bot read all of them right away or only the first few? → A: Read all of them, with no cap (30 links should work), in a queue, with limited retries. **Moved to feature 002** (see below).
- Q: How should I be able to tell the bot is still working, or that nothing has stalled, when I share many links? → A: An immediate "Saved N links, reading them now" reply and a final summary. **Moved to feature 002** (see below).
- Scope decision (after clarify): the queue, unlimited links, retries, the acknowledgement and summary messages, and keeping the daily fill-in off links still being read are split into a later feature 002 (bulk sharing), which fits with the backlog import. This feature keeps today's handling of several links: up to 10 per message, each handled independently.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shared link is understood when it is saved (Priority: P1)

I share a link to the saves bot from my phone, with or without a note of my own. The bot reads
the page and replies with its title, a short snippet of what it is about, and one to three
English tags. From the reply I can tell the bot understood the link, and I don't have to wait
for the next day's fill-in to find out.

**Why this priority**: This is the whole point of the feature. Today the bot replies "Saved ✓"
with the page's title and keeps the page's own description when it has one, but tags and a
proper snippet only appear after the next day's fill-in. So the reply doesn't tell me what the
link is about or how I will find it again.

**Independent Test**: Share one link to a public article, then check the reply and the saved
entry. It delivers value on its own, even if nothing else in this feature exists.

**Acceptance Scenarios**:

1. **Given** a public article that can be read without logging in, **When** I share its link,
   **Then** the reply shows the title, a short snippet, and between one and three English tags,
   and the saved entry holds the same title, snippet and tags.
2. **Given** I share the same kind of link with a note of my own, **When** the bot replies,
   **Then** my note is saved exactly as I wrote it and is not replaced by the snippet.
3. **Given** a page written in Vietnamese, **When** I share it, **Then** the snippet is in
   Vietnamese and the tags are in English.
4. **Given** I have used the tag "ai-tools" before, **When** I share a link about the same
   subject, **Then** the bot reuses "ai-tools" rather than inventing a near-duplicate.

---

### User Story 2 - Unreadable link is still saved and handed to the daily fill-in (Priority: P2)

I share a link the bot cannot read: it sits behind a login, the post was removed, the site
returned an error, or the page took too long. The link is saved anyway with my note, and the
reply plainly says it could not be read. It stays on the list for the daily fill-in to try.

**Why this priority**: Many of my links come from Facebook, Instagram and Threads, which often
need a login. A save must never be lost or blocked because reading failed.

**Independent Test**: Share a link to a post that needs a login and one to a page that no longer
exists. Both appear as saved, both replies say they could not be read, and neither has a snippet
or tags.

**Acceptance Scenarios**:

1. **Given** a link to a page behind a login, **When** I share it with a note, **Then** the link
   and my note are saved, the reply says the page could not be read, and no snippet or tags are
   invented.
2. **Given** a link to a removed post or a page that returns an error, **When** I share it,
   **Then** the link is saved and the reply says it could not be read.
3. **Given** a page that does not respond, **When** I share it, **Then** the bot gives up on it
   after a limit, still replies saying it could not be read, and the link is saved.
4. **Given** a link that could not be read at save time, **When** the daily fill-in next runs,
   **Then** it picks that link up as still needing details.
5. **Given** a page that gives a title and snippet but no usable tags, **When** I share it,
   **Then** the title and snippet are saved and shown, the reply says tags could not be made, and
   the link is left for the daily fill-in to add only the tags.
6. **Given** a link I saved earlier that could not be read, **When** I share it again and the
   page can now be read, **Then** the missing details are filled in, shown in the reply, and my
   earlier note is kept.

---

### User Story 3 - Daily fill-in only fills what is missing (Priority: P3)

The daily fill-in no longer re-reads everything. It skips links that were already read when I
shared them, and for the rest it fills in only the details that are still empty, without
overwriting anything already there.

**Why this priority**: It avoids wasted work and keeps the fill-in from undoing details I have
already seen in the bot's reply. It matters less than the first two stories because the feature
already delivers its value without it.

**Independent Test**: Share one readable link and one unreadable link, then run the daily
fill-in. The readable link's details are unchanged and it was not fetched again; the unreadable
link now has whatever the fill-in could find.

**Acceptance Scenarios**:

1. **Given** a link that was read successfully at save time, **When** the daily fill-in runs,
   **Then** its title, snippet and tags are unchanged and the page is not fetched again.
2. **Given** a link saved with a title but no snippet or tags, **When** the daily fill-in runs,
   **Then** it adds the snippet and tags and keeps the existing title.
3. **Given** a link that still cannot be read when the daily fill-in tries, **When** the run
   finishes, **Then** nothing already saved for that link is lost.

---

### Edge Cases

- A message contains several links: as today, up to 10 are saved and read, and links past the
  10th are ignored. Each link is handled independently: one failing or being slow does not stop
  or delay the others. The bot sends one reply with one block per link, naming it.
- I share a link I already saved: no duplicate entry is created and my earlier note is kept. If
  I add a new note, it is added after the earlier one, unless the earlier note already contains
  it (as today). If the link was fully read before, the reply shows what is saved and the page is
  not read again. If it was not fully read, the page is read again now and only the missing
  details are filled in.
- The link is a short or redirecting address: the entry is the same one I would get from the
  full address.
- The page has almost no text (an image, a video, a PDF, a page that needs scripts to show
  anything): treated as could not be read.
- The page is very long: the snippet stays short.
- The page contains text that tries to give the bot instructions: it is ignored, and only a
  title, snippet and tags come from it.
- The page is readable but only some details come out (for example no usable tags): what was
  found is kept and shown, the reply says what is missing, and the link is left for the daily
  fill-in to complete. Nothing is made up to fill the gap.
- A message has a note but no link: behaves exactly as it does today.
- A message comes from anyone other than me: no read happens and no reply is sent, as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When I share a link, the system MUST save it before it tries to read the page, so a
  reading failure can never lose the save.
- **FR-002**: For a readable page, the system MUST reply with the page's title, a short snippet
  of what it is about, and between one and three tags.
- **FR-003**: Tags MUST be lowercase English words, even when the page is in another language.
- **FR-004**: The snippet MUST be in the page's original language and at most 400 characters,
  the same limit the daily fill-in uses. (Today the bot stores the page's own description at up
  to 600 characters; this feature brings new saves down to 400. Existing entries are not
  changed.)
- **FR-005**: The system MUST store whatever title, snippet and tags it found on the saved
  entry, and MUST mark the entry as filled in only when both a snippet and at least one tag were
  produced, so the daily fill-in treats only those entries as done.
- **FR-006**: The system MUST prefer tags that already exist in my saves over new ones when an
  existing tag fits.
- **FR-007**: My own note MUST be saved exactly as I wrote it and MUST NOT be overwritten or
  altered by anything read from the page.
- **FR-008**: When a page cannot be read at all (login wall, removed post, error, timeout, or too
  little text), the system MUST still save the link and my note, MUST reply that it could not be
  read, MUST NOT store an invented snippet or tags, and MUST leave the entry for the daily
  fill-in.
- **FR-009**: The system MUST NOT try to get past a login. For a login-walled link it keeps only
  my note, the title and the URL.
- **FR-010**: Text found on a page MUST be treated as content to summarize, never as instructions
  to the system.
- **FR-011**: The system MUST give up on a page that is slow or unreachable after a limit rather
  than wait forever, and MUST still save the link and reply.
- **FR-012**: Sharing a link I have already saved MUST NOT create a duplicate and MUST NOT
  discard the existing title, snippet, tags or note. A new note MUST be added after the earlier
  note unless the earlier note already contains it, as today. If the entry was fully read before,
  the system MUST reply from what is saved without reading the page again. If it was not, the
  system MUST read the page again and fill in only the details that are still empty.
- **FR-013**: For a message with several links, the system MUST handle up to 10 links, each
  independently (one failing or being slow MUST NOT stop or delay the others), and MUST send one
  reply with one block per link, naming it, in the order the links appear in the message.
- **FR-014**: The daily fill-in MUST skip entries already marked as filled in, and for the
  remaining entries MUST fill only the details that are still empty, never overwriting an
  existing title, snippet, tags or note.
- **FR-015**: Only I can trigger a read: messages from anyone else MUST get no reply and cause no
  fetching.
- **FR-016**: When a page yields only some of the details, the system MUST keep and show what it
  found, MUST say which details are missing in the reply, and MUST leave the entry for the daily
  fill-in to complete only the missing parts.

### Key Entities

- **Saved link**: one entry per link I share. Holds the link, my own note, a title, a short
  snippet, up to three tags, and whether details have been filled in. Created when I share a
  link; filled in either at save time or later by the daily fill-in.
- **Reply**: the message the bot sends back for one message I share. It has one block per link,
  saying either what the page is (title, snippet, tags), what is missing, or that it could not
  be read.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For public pages that can be read without a login, the reply includes a title, a
  snippet and 1–3 tags in at least 9 out of 10 shares.
- **SC-002**: 100% of shared links (up to 10 per message) end up saved, whether or not the page
  could be read.
- **SC-003**: When I share 10 links in one message, all 10 are saved and the reply has exactly
  one block per link, each naming its link, with none lost, duplicated or mixed up.
- **SC-004**: 100% of replies for unreadable links say plainly that the page could not be read,
  and 0% of them contain a made-up snippet or tags.
- **SC-005**: After the daily fill-in runs, 0 entries that were read at save time have a changed
  title, snippet, tag list or note, and 0 of them were fetched again.
- **SC-006**: In a trial of 5–10 sample links covering Facebook, Instagram, Threads, X, Reddit
  and ordinary web pages, I can tell from each reply alone whether the link was understood.

## Assumptions

- The saves bot already exists. Today it saves a shared link with the title and description the
  page publishes for link previews and replies "Saved ✓" with the title; this feature adds a
  proper snippet, tags, and a reply that shows them.
- "Read" means what a logged-out visitor can see. Platforms that hide content from logged-out
  visitors will mostly count as could not be read; which ones is not yet tested.
- A link counts as fully read (filled in) only when both a snippet and at least one tag could be
  produced. A partial result is kept and shown, and the rest is left for the daily fill-in.
- A page that is gone (removed or missing) is only reported as could not be read here. Marking
  it as a dead link stays with the daily fill-in, as today.
- Tags use the same English, lowercase style and the existing tag list the daily fill-in uses.
- Speed is not a target: a single link normally gets its reply within seconds, and a message
  with several links takes about as long as its slowest page.
- A failed read is not retried at save time; the daily fill-in is the retry.
- The existing owner-only rule is unchanged: the bot answers only me.
- Out of scope: importing old saves, changing the Saved Items page, changing the Friday digest,
  and editing tags from the chat.
- Deferred to feature 002 (bulk sharing): more than 10 links per message, a reading queue,
  retries, an immediate "reading now" acknowledgement and final summary, a status command, and
  keeping the daily fill-in off links the bot is still reading.
