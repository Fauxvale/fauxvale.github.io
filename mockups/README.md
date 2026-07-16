# UX mockups for The Adventures of Jules

Two drafts exploring a friendlier structure for `The-Adventures-of-Jules.html`.
**The original file is untouched.** These existed to pick a direction before rewriting the
generator skill at [Fauxvale/skyrimnet-save-explorer](https://github.com/Fauxvale/skyrimnet-save-explorer).

> **Outcome: A was chosen.** The app shell, plus the payload fixes below, are folded back into
> the skill in [skyrimnet-save-explorer#3](https://github.com/Fauxvale/skyrimnet-save-explorer/pull/3).
> These files stay as the evidence behind that decision — and B stays as the argument that
> didn't win, which is worth keeping legible if the question is ever reopened.

Open either by double-clicking. No server needed.

| File | What it explores |
|---|---|
| `mockup-a-shell.html` | **App shell** — sidebar, one view at a time, no long scroll — **chosen** |
| `mockup-b-story.html` | **Day spine** — the run reorganised by in-game day |

Both are wired to the real payload: 255 memories, 163 captures, 54 whispers, 62 interactions.

---

## The actual problem

The page isn't just long — it's **organised by database table, not by anything a reader
cares about**. It prints all 255 memories, then all 15 kill rows, then all 163 captures,
each a complete dump of one table, every section expanded. Reaching section VI means
scrolling past ~450 records.

That structure isn't an accident of this page. It's what `references/page-build.md`
*prescribes* — "Two tabs at the top", a floating TOC, and one section per payload key. The
skill is a prose spec, not a template, so fixing the page means rewriting that spec.

---

## What both mockups fix, regardless of direction

- **A capture lightbox.** The original builds 163 `<img>` tags and ignores clicks on them.
- **Lazy images.** All 163 were eager-loaded even though only 12 were visible.
- **Full-text memory search**, with highlighted hits. The original has no text search anywhere.
- **A mind filter that reaches all 80 actors**, not the top 5 as chips.
- **Undated records are shown, never dropped.**

---

## What the data actually supports

Verified by parsing the payload, not assumed. This is what constrains the day spine:

| Source | Records | Has a calendar day? |
|---|---|---|
| `memories` | 255 | 248 yes, **7 null** |
| `screenshots` | 163 | Only by parsing `ts` — see below |
| `events_by_day` | 219 keys | **Counts only** — no event text exists |
| `leaderboard` / `diary` / gossip / interactions | 15 / 3 / 54 / 62 | **No** |
| `IE.events` / `IE.battles` | 32 / 3 | **Different axis** — numeric `3.3`–`15.4` |

Three consequences:

1. **IntelEngine can't join the spine.** Its day numbers are a separate scale. Mapping them
   onto calendar dates would be a guess that invents story, so B keeps it on its own tab.
2. **A day can't narrate itself.** `events_by_day` is a tally, so per-day activity is a
   breakdown; the memories carry the story.
3. **Kills, diary, gossip and the feature have no day at all** — B is a *hybrid*, with a
   "Ledgers" area for them. That seam is inherent, not a shortcut.

---

## Bugs found in the payload while building these

These are generator bugs, not page bugs. They'd be worth fixing whichever direction wins.

### `gt` mixes two units

`payloads.md` calls `gt` "raw `game_time`, for chronological sorting". In practice:

- 249 memories → in-game clock, `0` – `1,281,339`
- **6 memories → a Unix epoch.** `1784014205` decodes to **2026-07-14 07:30 UTC** — the day
  the page was built. Wall-clock leaked into a game-time field.

And the correlation is exact: **`day == null` ⟺ `gt` is unusable.** Those 6, plus one with
`gt == 0`, are precisely the 7 undated memories. The undated rows aren't random — they're
the rows whose timestamp is nonsense.

**`gt` is not broken, it's contaminated.** Sorting the 249 well-formed rows by `gt`
reproduces `ordered_days` with **zero inversions**. It only looks broken because 6 rows sort
a thousandfold past the end. The fix is to quarantine the outliers at build time, not to
abandon `gt` sorting.

> Still to confirm against the source DB: whether `memories.game_time` itself holds the
> epoch values, or the extraction introduces them. The page alone can't tell.

### `screenshots[].day` would help, but isn't sufficient on its own

`omnisight_screenshots.capture_time_game` and `events.game_time_str` share a format, so one
rule extracts a day from both, and the generator should emit `screenshots[].day` rather than
making the browser parse `ts` (whose format `payloads.md` never specifies — B currently
parses it, which works for Jules at 163/163 but is **not shippable**).

But that alone doesn't close it: **`ordered_days` is built from the `events` table only**, so
a capture on an event-less day has no slot. Jules can't reveal this — it has events every
day. `?data=nulldays` includes such a capture; it lands in Ledgers → "Captures with no day".
The real fix is `ordered_days` as a **union of all day-bearing sources**.

### `IE.events[].day` is undocumented

`payloads.md` specs no `day` on IntelEngine events, but the generator emits one, on a scale
unrelated to everything else.

---

## Fixtures — why Jules alone can't validate a design

The skill must generate for *any* save. **Jules is a rich save and hides every empty-state
bug.** Append these to either mockup's URL:

| URL | What it forces |
|---|---|
| `?data=minimal` | 2 days, 13 memories, **no captures, no diary, no war, no gossip, no feature** |
| `?data=nulldays` | **153/255 memories undated** with epoch-contaminated `gt`; 2 captures unmatchable to a day |

`?data=minimal` already caught a real bug: B's rail stretched two lonely bars across the
whole viewport, because the columns were `flex:1`. Fixed by capping column width.

---

## The two directions

### A — App shell (`mockup-a-shell.html`)

Sidebar, hash routing (`#/memories`), one view at a time. An Overview lands you with stat
tiles, the day chart, top minds and heaviest memories, each linking onward. Every screen owns
its own search/filter/paging — memories page 25 at a time (11 pages). The diary's page-flip
widget, heavy chrome for 3 entries, is flattened to cards.

**Strengths.** Kills the scroll outright. Familiar. Every section is findable from anywhere.
Degrades trivially — a missing section is one fewer sidebar row, which is exactly how the
skill already treats war/diary/gossip.

**Weaknesses.** It's a database browser with good manners. It doesn't make the run feel like
a story, and the data stays organised by table — just paginated. Least ambitious.

**Cost to ship.** Phase 3 only. **No payload change required.**

### B — Day spine (`mockup-b-story.html`)

A rail of the 14 days across the top, each bar scaled to that day's event count — chart and
navigation in one. Pick a day and everything from it merges: event breakdown, that day's
memories, that day's captures in time order, the places visited. Arrow keys move between days.

- **Undated is a first-class stop on the rail** (the hatched `N/A`), not a footnote.
- **Ledgers** holds what has no day: kills, diary, whispers, the Dagoth Ur thread, the
  constellation, and any orphaned captures. Each says *why* it's there.
- Selecting a day and opening Ledgers lights that day's stars in the constellation — the one
  place the spine and the whole-run view meet.
- **IntelEngine** keeps its own tab and states plainly that its clock is different.

**Strengths.** It's the only one that reads as *The Adventures of*. A day is a comprehensible
unit; 14 of them is a table of contents a person can hold in their head. It surfaces
relationships the original can't — the captures from a day sit beside the memories from it.

**Weaknesses.** It's a hybrid, and the seam shows: roughly a third of the content lives in
Ledgers because it has no day. It's the direction most exposed to bad data — under
`?data=nulldays` the undated bucket swells to 153 memories and starts to look like the
original dump (capped at 40 with a "show all"). A 2-day save makes the rail near-pointless.

**Cost to ship.** Phase 2 **and** Phase 3. Needs `screenshots[].day`, `ordered_days` as a
union, and the `gt` quarantine.

---

## Recommendation — and what was decided

**A is the safer refactor; B is the better page.** A is what the current payload can support
today; B is what the data *wants* to be, and it needs the payload fixed first.

**A was chosen**, and is now the spec in
[skyrimnet-save-explorer#3](https://github.com/Fauxvale/skyrimnet-save-explorer/pull/3) — along
with the `gt` quarantine, which lands regardless of direction because it's a real bug. B's day
spine is not rejected on merit; it's parked behind a payload contract change. The argument for
it is preserved below and in the mockup itself.

They aren't mutually exclusive, and that's the most useful finding here. B's day view is a
better *reading* experience; A's per-screen search/filter/paging is a better *finding*
experience — and B has no answer for "where did Lydia come up?" A's Overview and B's day rail
are near-identical components. A plausible third option is **B's spine as the default view
with A's sidebar for the ledgers and a global search** — but that's a bigger rewrite, and it
should be argued from these two rather than assumed.

The `gt` quarantine should land regardless. It's a real bug, it's cheap, and both directions
are better for it.

---

## Files

| Path | Notes |
|---|---|
| `mockup-a-shell.html` | Direction A |
| `mockup-b-story.html` | Direction B |
| `tome.css` | The Illuminated Manuscript look, lifted from the original so the mockups are judged on structure, not restyle. Record components only — each mockup owns its shell. |
| `tome.js` | Shared helpers, ported from the original. **The `prep` block is work the browser shouldn't do** — it's there to make the payload's gaps visible, and is what moves into Python if a direction wins. |
| `jules-data.js` | Generated from the original's four JSON payloads. Never hand-edit — run `python tools/extract-data.py`. |
| `fixtures/*.js` | Generated synthetic edge cases. Never hand-edit — run `python tools/make-fixtures.py`. |
| `tools/` | The two generators. Both read `The-Adventures-of-Jules.html` read-only and are deterministic, so the generated files can be rebuilt from the page at any time. |

The mockups share a data file rather than inlining 471 KB twice, which keeps each one ~30 KB
of readable code. `<script src>` resolves over `file://` (verified). **If a direction wins,
re-inline the payload** to restore the skill's one-self-contained-file rule.

## Verified

Both mockups, driven headless over `file://`:

- No console errors, no `undefined`/`NaN`, on 13 A-routes and both mockups × {Jules, minimal, nulldays}
- No horizontal overflow at 360 / 414 / 768 px, normal and `prefers-reduced-motion`
- All **163/163** captures resolve; lightbox opens, decodes real 1280×720 images, arrows and Escape work
- Busiest day (28th: 50 memories, 306 events, 11 captures) and the 26-capture day (25th) render clean
- Search: "lydia" → 105/255, every visible row genuinely matching; markup in the query is escaped, not injected
- The 7 undated memories are visible and explained in both
- `git status` confirms `The-Adventures-of-Jules.html` is unmodified
