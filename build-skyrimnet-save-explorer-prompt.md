Please build me a **SkyrimNet Save Explorer**: one self-contained, offline HTML file that
turns my Skyrim AI-mod playthrough (the **SkyrimNet** and **IntelEngine** mods) into an elegant,
interactive "save explorer" web page. Think of it as an illuminated field journal for a single
character's run.

The finished page has **two tabs**:

- **SkyrimNet** — my character's lived experience: an event timeline, an interactive "constellation"
  of their memories, the memories themselves, a kill ledger, a diary page, OmniSight field notes (with a
  distilled "portrait of the land" and matched local capture images), and any other notable story beats
  discovered in the logs.
- **IntelEngine** — the political layer: faction relationships, a chronicle of provocations between
  factions, off-screen gossip, and — **only if my save actually has one** — an ongoing war and its battles.

Every section on the page is **collapsible**, there is a **floating table of contents** that reflows into a
mobile bar + overlay on narrow screens, and everything — the character's name, the number of in-game days,
every count and label — must be **derived from my uploaded data**. Nothing is hardcoded from any example.

**Do not build anything yet.** First collect my files, one at a time, following the protocol below.

---

## Phase 1 — Collect the files (one step at a time)

Ask me for **one file at a time**, in the order below. After each upload, **inspect the file and tell me
what you found** (row counts, the character's name, the date range, anything missing) before asking for
the next one. Wait for each upload — do not ask for everything at once. While inspecting, also **flag
anything notable that the standard layout doesn't cover** — a major world event, a quest arc, a
milestone, an unusual populated table — and ask whether I'd like a new dedicated section for it (see
"Beyond the standard layout" in Phase 3).

The databases are **SQLite**. Inspect them with Python's built-in `sqlite3` module (the `sqlite3` CLI may
not be available). Run read-only queries only — never modify my files. Note: if a read-only URI handle
(`file:...?mode=ro`) fails to open (e.g. the upload is on a read-only mount), copy the DB to a writable temp
location first and open the copy — still issuing SELECTs only.

### Step 1 — the SkyrimNet database

Ask me to upload my **SkyrimNet database** — a file named like `SkyrimNet-<numbers>.db`.

When it arrives, read its schema and confirm the tables below exist and how many rows each holds. This DB
is the source for most of the **SkyrimNet tab**:

- **`memories`** — first-person memories. Columns you'll use: `content` (the memory text), `actor_uuid`,
  `location`, `game_time` (a float in-game clock), `importance_score` (~0.5–0.85), `emotion`,
  `memory_type` (e.g. `EXPERIENCE`, `RELATIONSHIP`, `KNOWLEDGE`, `TRAUMA`, `SKILL`), `tags` (JSON array),
  `related_event_ids` (JSON array).
- **`memory_embeddings`** — one row per memory: `memory_id`, `embedding` (raw vector bytes), `dimension`
  (e.g. 384). These power the "Constellation" scatter. **Decoding gotcha:** the value is served as TEXT,
  not BLOB, so set `con.text_factory = bytes` before reading — otherwise Python's sqlite3 tries to
  UTF-8-decode it and will either throw ("Could not decode to UTF-8") or report a wrong `LENGTH()`
  (character count of mangled multibyte text, not real byte count). Even with `text_factory = bytes`,
  SQLite's `LENGTH()` may still report a mangled character count — **`np.frombuffer(blob, dtype=np.float32)`
  on the raw column is authoritative**, and yields exactly `dimension` floats (`dimension × 4` bytes;
  384 → 1536) of little-endian IEEE-754 float32, no header, no compression — see the projection recipe in
  Phase 2.
- **`events`** — the full event log (often 1000+ rows). Columns: `event_type`, `event_data` (JSON),
  `location`, `game_time`, and **`game_time_str`** — a human date like
  `"7:45 AM, Middas, 20th of Last Seed, 4E 201"`. This drives the day timeline and (via `death` events)
  the kill ledger. Also read `originating_actor_UUID` / `target_actor_UUID` and `playtime` where present.
- **`uuid_mappings`** — maps the big numeric `uuid` values to a readable `actor_name`. Use it to turn
  every `actor_uuid` / actor UUID into a name. **The player character's name comes from here** (the
  actor flagged as the player, e.g. bio template `player_special`).
- **`omnisight_screenshots`** — captured location/scene notes: `subject_name`, `description` (rich prose),
  `location_name` / `location_cell`, and a `capture_time_game` date. (The actual screenshot pixels are
  **not** in the DB logs; use the text + metadata, plus any matching files in `omnisight-images/` when
  embedding the OmniSight cards.)
- **`diary_entries`** — long-form first-person journal `content` with an `emotion` and `entry_date`.

Tell me the character's name and the in-game date span you detected, then proceed.

### Step 2 — the IntelEngine database

Ask me to upload my **IntelEngine database** — a file named like `IntelEngine-<numbers>.db`. This is the
source for the **IntelEngine tab**. Confirm these tables:

- **`faction_relations`** — pairwise standings: `faction_a`, `faction_b`, `relation_score` (−100…+100),
  `war_active`, `trade_active`.
- **`faction_wars`** — active/past wars: `faction_a`, `faction_b`, `battles_fought`, `faction_a_morale`,
  `faction_b_morale`, `faction_a_strength`, `faction_b_strength`, `victor`, `start_time`. **May be empty** —
  many saves never trigger a war at all.
- **`war_battles`** — `location_name`, `attacker`, `defender`, `result`, `attacker_losses`,
  `defender_losses`, `narrative`. Also empty when no war has broken out.
- **`faction_events`** — provocations/incidents: `faction_a`, `faction_b`, `event_type`
  (e.g. `war_declaration`, `border_skirmish`, `espionage`, `assassination_attempt`, `battle_result`,
  `tariff`, `trade_dispute`, `insult`), `description`, `relation_delta` (a signed integer), `game_time`.

If I also happen to have a small **`political_state.json`**, use it for **faction identity** — display
names, leaders, and holds — which give you readable faction labels for the relations/chronicle sections. It
also mirrors the current war/relations state as a convenience, but the IntelEngine DB is authoritative for
the numbers.

Then **tell me whether this save has a war** — i.e. whether there are any rows in `faction_wars` /
`war_battles`, or a `war_declaration` in `faction_events`. If there is no war, the war and battle sections
described later are simply left out; the rest of the IntelEngine tab still gets built.

### Step 3 — the SkyrimNet logs

Ask me for my **SkyrimNet logs**. Explain what each log offers so I can upload the right one(s), and pick
whichever you actually need rather than demanding all of them:

- **`openrouter_output.log`** (~1 MB — *recommended*) — the model's structured outputs. This is the only
  source for the **gossip** section, and a good source for diary/OmniSight text. Keep OmniSight images
  sourced from the local `omnisight-images/` files.
- **`conversation_log.log`** (~78 KB) — the raw player↔NPC / NPC↔NPC dialogue transcript (corroboration only).
- **`openrouter_input.log`** and its dated siblings (~4–13 MB each) — mostly the *prompts* sent to the
  model; large and largely redundant with the DBs. Usually **skip these**; they may be too big to upload.

These logs are **not** JSON-lines. Each entry is a header line followed by a body. Split on the header
pattern:

```
^\[.*\] \[.*\] (Generate request|Generate response|GenerateStreaming complete response) \[req_.*\]:
```

then JSON-parse the block that follows (guard for plain-text and ```json-fenced bodies; a body may be a
single object or an array of objects). **Discard** the startup health-check pings that read
`"Hello! Yes, I'm working"`. Expect a large fraction of blocks to be un-parseable request echoes or
streaming fragments — that's fine; keep the ones that parse.

Two families of objects matter:

1. **Gossip** — objects with `type:"npc_gossip"`:

```json
{ "type": "npc_gossip", "npc": "Arivanya", "npc2": "Ulundil",
  "narration": "leaned close and murmured about the Stormcloak uproar...",
  "gossip": "Ulfric called Thalmor justiciars parasites on Nord soil — loudly, in the square" }
```

   `npc` is the speaker, `npc2` the listener, `narration` the scene, `gossip` the rumor. (Some are
   `type:"npc_interaction"` with `fact1`/`fact2` instead — you may include those as memories exchanged.)

**If I don't provide logs, don't invent gossip** — hide or annotate that section and tell me it was
skipped for lack of a log file.

### Step 4 — external assets (optional)

Beyond the databases and logs, I may hand you **external assets** to use in the build — fonts (`.ttf`/`.otf`/
`.woff2`), images or textures (borders, panels, icons, backgrounds), or a batch of OmniSight capture
images. **When I supply an asset, you may use it directly** rather than recreating or approximating it:
inspect what I gave you and tell me what you found (dimensions, format, what it looks suited for). There are
**two ways to wire an asset in**:

- **Embed (default, for a single self-contained file):** inline the asset as a **base64 data URI** — fonts
  via `@font-face`, images via `url(data:...)` / `border-image` / `<img src="data:...">` — so the whole
  build is one file that opens offline.
- **Reference directly:** keep the asset as a real file and point the page at it by **relative path**.
  Deliver those asset files **alongside** the `.html` in an `assets/` folder when that is the intended
  packaging, so the page still opens offline from the local folder, just not as a lone file.

Keep a CSS/SVG fallback ready for anything I *don't* supply, and tell me plainly which assets you used
(and how you wired them) and which you fell back on. If I want OmniSight image embeds, ask me whether I want
to upload my OmniSight screenshots; if I say yes, I’ll provide the images and you should place them in
`omnisight-images/` and embed them in the OmniSight cards.

Use only assets I actually provide through the chat — never fetch, download, or invent them. For **my own
theme**, assets are optional: ask only when they fit what I described, and don't demand them. For OmniSight
image embeds, ask first whether I want to upload the screenshots (specify that I should upload them as one 
archive, rather than uploading individual images), then place the provided image files in
`omnisight-images/` and wire them into the cards.

---

## Phase 2 — Transform the data

Build the JSON payloads to embed in the page. Derive everything from my files.

### SkyrimNet payload (`sndata`)

- **`player`** — the player character's name (from `uuid_mappings`).
- **`stats`** — headline numbers for the header: total events, total memories, number of distinct minds
  (actors that have memories), OmniSight captures, in-game day count, and a one-line subtitle (character
  name + the in-game date span, and playtime hours if derivable from `playtime`).
  **Total Spend is opt-in and user-supplied:** the header can include a "Total Spend" stat — the
  real-world money I spent running this playthrough (API/LLM calls and the like), **not** any in-game gold.
  There is no way to derive this from my files. Before finalizing the header, **ask me whether I'd like to
  include a Total Spend statistic**. If I say yes, **literally ask me how much (in real dollars) I've spent
  on API calls etc. for this run**, and use the figure I give you **verbatim** (whatever I type, formatted as
  I type it). If I say no, skip the stat entirely.
- **`events_by_day`** — a map keyed `"<in-game day label>|<event_type>" -> count`. Parse the day/date out
  of `events.game_time_str` (e.g. `"20th of Last Seed"`), and count events per `(day, event_type)`. Also
  emit an ordered list of day labels. The page buckets `event_type`s into five categories — build the same
  mapping:
  - **Dialogue** (gold): `dialogue`, `dialogue_background`, `dialogue_npc`, `dialogue_player`,
    `dialogue_player_stt`, `dialogue_player_text`, `gamemaster_dialogue`
  - **Death & combat** (blood red): `death`
  - **Thoughts & narration** (steel blue): `player_thoughts`, `direct_narration`, `diary_entry_created`
  - **Trade, rest, world** (moss green): `trade_start`, `trade_complete`, `sleep_start`, `sleep_stop`,
    `book_read`, `furniture_used`, `item_given`
  - **Followers & tasks** (grey): anything else
- **`memories`** — an array; for each memory: `content`, `actor` (resolved name via `uuid_mappings`),
  `emotion`, `location`, `imp` (= `importance_score`), `type` (= `memory_type`), `day` (an in-game day
  label from `game_time`/related event), `gt` (raw `game_time`, for chronological sorting), and 2-D
  coordinates `x, y` (PCA) and `ux, uy` (UMAP) — see the projection recipe below.
- **`edges`** — an array of `[i, j, similarity]`: for each memory, its **2 nearest neighbors** by cosine
  similarity in the full embedding space, with the similarity value.
- **`leaderboard`** — kills aggregated per killer, ranked by total. Each entry:
  `{ killer, total, cats: { <category>: count }, victims: [[victim_name, count], …] }`. Parse `death`
  events (killer/victim from `event_data`, falling back to `originating_actor_UUID`/`target_actor_UUID`),
  resolve names via `uuid_mappings`, and bucket each victim into a small fixed set of categories —
  **People, Undead, Wildlife, Monsters, Dragon** — for the stacked bar.
- **`diary`** — the diary as `{ actor, loc, content, emotion }` (an array if there are several entries).
  Keep `content`'s paragraph breaks and any `*emphasis*` markers intact.
- **`screenshots`** — OmniSight captures as `{ name, loc, ts, desc }` from `omnisight_screenshots`
  (`ts` = the capture date/time string; `loc` = readable location/cell). Match each capture to the
  corresponding local image in `omnisight-images/` and embed that image in the card.
- **`omni_summary`** — **a synthesized "portrait of the land."** Read **all** of the OmniSight descriptions
  and distil them into one cohesive prose description of the whole landscape the run passed through: a
  `{ title, paragraphs:[…2-3 paragraphs…], foot }` object. Ground it strictly in what the captures actually
  describe — the real named places, terrain, structures, wildlife, weather, and mood (do a quick frequency
  pass over the text to find the recurring places and atmosphere) — and **never invent** locations or events
  that aren't in the captures. Make `title` something like `"A Portrait of the Land"` and `foot` a derived
  line like `"Distilled from all <N> OmniSight captures — <first day> to <last day>, 4E 201."`

**Actor colours:** rank actors by memory count; the **top ~5 get distinct colours**, everyone else is grey.
Reuse this mapping everywhere an actor is coloured (constellation dots, memory rows, leaderboard names).

**Computing the projection (`x,y` / `ux,uy`) and edges** — do all of this offline in Python; the browser
only ever receives coordinates, edge indices, and similarity weights, never the raw vectors:

1. **Decode.** Open the DB with `con.text_factory = bytes`. Join `memory_embeddings` to `memories` on
   `memory_id` and decode each embedding with `np.frombuffer(blob, dtype=np.float32)`. Expect
   `len(vec) == dimension` (384). If lengths are `dimension × 2` bytes it's float16; anything
   smaller/irregular suggests a compressed store — but standard SkyrimNet DBs are plain float32. Stack into
   an `N × dimension` matrix **in memories order**, so row *i* is memory *i* everywhere downstream
   (tooltips, filters, and edges all index this one shared array).
2. **PCA → `x,y`.** Mean-center the matrix and take the top-2 principal components via SVD (top two singular
   vectors scaled by their singular values). Report the fraction of variance those two components capture
   (sum of top-2 squared singular values / total) in the section caption — usually ~20%, an honest "blurry
   linear shadow" of the space.
3. **UMAP → `ux,uy`.** Run UMAP on the same matrix with **`metric='cosine'`**, `n_neighbors=10`,
   `min_dist=0.15`, and a fixed `random_state` for a reproducible layout. Cosine is deliberate — it's the
   metric the mod's memory recall actually uses. If `umap-learn` isn't installed, try to `pip install` it;
   failing that fall back to cosine t-SNE (sklearn); failing that reuse the PCA coords for `ux,uy`.
   **Tell me plainly which you used.** Normalise both projections into a comparable 0–1 range.
4. **Edges (computed in the full space, not the projection).** L2-normalize every row, compute the full
   cosine-similarity matrix (`Xn @ Xn.T`), and for each memory keep its top-2 most-similar neighbors above
   a similarity floor (~0.75). Dedupe symmetric pairs into an undirected list; ship each as
   `[index_a, index_b, similarity]`, with similarity driving line opacity. Because edges are truth from the
   384-d space while positions are projected, long edges in PCA are exactly the neighbor pairs the linear
   projection tore apart — a built-in diagnostic.
5. **Serialize.** Round coordinates to ~4 decimals and embed as JSON. When writing into the
   `<script type="application/json">` tag, escape `</` as `<\/` so no memory text can accidentally close the
   script block.

The same `text_factory = bytes` trick applies to any SkyrimNet DB you inspect with Python.

### IntelEngine payload (`inteldata`)

- **`relations`** — from `faction_relations`: each pair with its signed `relation_score`, whether a war is
  active, and readable faction display names (via `political_state.json` if present, else de-camelCased).
- **`factions`** — from `political_state.json` if present: `{ name, leaders, hold }` for each, used for
  readable labels, hover detail, faction colours, and whisper classification.
- **`war`** — from `faction_wars`, **only if a war exists**: the belligerents, `battles_fought`, the war's
  start, both sides' morale & strength, victor status, each side's leaders, and who declared it (from the
  `war_declaration` `faction_event`). Omit this key entirely when there's no war.
- **`battles`** — from `war_battles`: location, attacker/defender, result, losses on each side, narrative.
  Empty or omitted when there's no war.
- **`events`** — from `faction_events`: the provocation chronicle — faction pair, `event_type`,
  `description`, signed `relation_delta`, ordered by `game_time`.

### Gossip payload (`gossipdata`)

An array of `{ speaker, listener, rumor, scene }` from the successful `npc_gossip` records in the output
log (`speaker`=`npc`, `listener`=`npc2`, `scene`=`narration`, `rumor`=`gossip`). Keep only **distinct**
exchanges (dedupe repeats). Empty if no log was provided. Displayed gossip must come **only** from these
saved outputs — the dialogue/input logs are corroborating provenance, not a source of new rumors.

---

## Phase 3 — Build the page

Produce **one self-contained `.html` file**. No build step, no frameworks, no external JavaScript or CSS
libraries. The only external references allowed are a Google Fonts `<link>` and any fonts/images you embed as
base64 data URIs. Embed the payloads as `<script type="application/json">` blocks and render everything with
**vanilla JS**. It must open by double-clicking the file offline. Honor
`prefers-reduced-motion` throughout, keep visible keyboard focus, and be responsive down to mobile.

### Structure (applies to every theme)

- **Header** — a centered header that reads **"The Adventures of &lt;name&gt;"**: a small gold eyebrow label
  (which switches per tab, e.g. "A SkyrimNet Field Journal" / "An IntelEngine Dispatch"), then a small
  italic serif kicker **"The Adventures of"**, then the character's name set **large and monumental**
  (uppercase display face). Below it, the italic subtitle and a row of stat blocks divided by thin rules
  (including Total Spend if I opted in).
- **Two tabs** at the top (`SkyrimNet` / `IntelEngine`) that swap the visible content and the table of
  contents.
- **No divider ornaments between sections** — section headers alone do the work: a roman numeral + an
  uppercase title + a trailing hairline. (Don't add decorative "knot"/rule divider strips between sections;
  they waste vertical space.)
- **Every section is collapsible.** The section header is a real toggle (`role="button"`, `tabindex="0"`,
  `aria-expanded`, keyboard Enter/Space) with a chevron that rotates when collapsed; collapsing hides the
  section body. **Exception:** in the Constellation section, the actor-filter chip row stays **outside** the
  collapsible body ("keep-visible") so those chips remain on screen and keep filtering the memory list
  (Section III) even when the constellation itself is collapsed.
- **Floating table of contents (desktop, ≳1120px):** pinned to the left, **vertically centered**, with a
  **roman-numeral index badge** beside each entry and a **clean active-section highlight** (the active
  badge fills with the accent colour, its label takes the accent colour, and a thin accent rule marks it);
  a scroll-spy keeps it in sync. The main page content must **shift clear of the pinned sidebar so they can
  never overlap**, and **re-center on wide screens** — e.g. give each centered column
  `margin-left: max(<sidebar-clearance>, calc((100vw − <content-max>)/2)); margin-right:auto;` so it hugs
  clear of the sidebar when the viewport is tight and returns to true center once there's room.
- **Table of contents (narrow, ≲1120px):** the sidebar is replaced by a **gradient top bar** (sticky, just
  below the tab bar) showing the current tab + roman badge + current section name, with a **hamburger** that
  opens a **full-screen overlay list** of all sections (roman badges, larger tap targets); tapping an entry
  scrolls to it and closes the overlay. The scroll-spy updates the bar's current-section label.
- Confirm there is **no horizontal overflow** at any width (watch section-header captions — let them wrap).

### Look & feel — ask me which theme

**Before you settle on any colors, fonts, or overall styling, ask me to pick one of two:**

1. **Preset theme — Illuminated Manuscript** (details below). If I pick this, apply it exactly; no need to
   ask anything further about design.
2. **My own theme** — I describe a color scheme and/or overall design I'd prefer. If I pick this, **invoke
   your design skill** (if available) and design the site to my specification — palette, typography, and
   styling — while keeping the same structure, sections, and interactions described here. Show me the
   resulting palette/type choices before building the full page. If no design skill is available, apply
   solid visual-design fundamentals to my brief. **If I supply my own fonts, images, or other assets**
   (see Phase 1, Step 4), embed and use them directly as base64 data URIs rather than approximating them.

#### Theme option 1 — Illuminated Manuscript (preset)

- **Fonts:** `Oswald` (uppercase, letter-spaced headings/labels), `Crimson Pro` (serif body),
  `JetBrains Mono` (numbers/metadata), via a Google Fonts `<link>`.
- **Palette (CSS `:root`):**
  `--bg:#14161a; --panel:#1a1d23; --text:#e8e4da; --dim:#98938a; --gold:#c9a45c; --steel:#7da3b8;
  --blood:#b0584e; --moss:#8ba06b;` plus subtle hairlines like `rgba(232,228,218,.16)`.
- **Category colours:** Dialogue = gold, Death = blood, Thoughts = steel, Trade/world = moss,
  Followers = dim/grey.
- **Motifs:** centered header, "double rule" style hairlines, roman-numeral section headers with trailing
  hairlines, the collapsible chevron, and the floating TOC / mobile bar described above.
*(Everything below is the structural baseline for whichever theme I pick.)*

### SkyrimNet tab — sections

1. **The Timeline** *(e.g. "Seven Days in Whiterun Hold" — derive the hold from the data if one dominates)* —
   one vertical stacked bar per in-game day, each segment a category colored per the theme, bar height ∝
   that day's event count, with a day label + total and a color legend. Built from `events_by_day`.
2. **Constellation of Memory** — an SVG scatter of every memory. Position from the projection; **dot size ∝
   importance**; **color by actor** (top ~5 actors distinct, the rest grey). Draw `edges` as faint lines
   (opacity ∝ similarity). Interactions: a **UMAP/PCA toggle** (updates positions and the caption; report
   the PCA variance fraction), **actor filter chips** (All / top actors / Everyone else) that dim
   non-matching stars **and** filter the Section III memory list, **hover tooltips** showing the memory text
   + meta, and **draggable stars** with a light spring simulation (home-spring + edge-spring + damping) so
   neighbors tug along. If reduced motion is set, place stars statically. The **actor-filter chip row stays
   visible when this section is collapsed** (see structure). Add a small **caption for mobile readers**
   beneath the scatter pointing them to Section III, where the same memories appear as a readable list.
3. **The Memories We Made** — the memories as a list, grouped by in-game day (each day gets a heading with
   its memory count and, if available, a one-line summary of that day). Each row: actor + `type · emotion`
   on the left, the memory text with its location beneath in the middle, and an **importance bar** (labelled
   `imp <score>`) on the right. Two chip rows drive it — **type filters** (All types + one per `memory_type`,
   with counts) and a **sort toggle** (chronological / by importance) — and the Constellation's actor filter
   applies here too. Include a short **note stating that the mind filter from the Constellation above also
   filters this list** (the two views stay in sync). Show a live "N of M memories shown" note.
4. **Blood Leaderboard** — the `leaderboard` payload as a ranked table of killers: a rank number
   (`01`, `02`, …), the killer's name (colored by their actor color), their **total kills**, a horizontal
   **stacked bar segmented by victim category** (People / Undead / Wildlife / Monsters / Dragon, each its
   own color) with a matching legend above, and a row of **victim chips** (`Bandit ×3`, `Draugr ×2`, …).
5. **The Diary** — render each diary entry as a centered "journal page": a bordered/inset panel, a header
   with the author and place, a **drop-cap** first letter,
   paragraphs split on blank lines, and `*starred*` phrases shown as italic emphasis. If several entries
   exist, present them as a book-like stack that can be flipped through. If there is no diary entry, omit the
   section.
6. **OmniSight Field Notes** — open with a framed **"A Portrait of the Land"** summary panel: the synthesized
   `omni_summary` prose (drop-capped first paragraph, a mono footer line naming the capture count and date
   span), distilled from **all** captures and grounded only in what they describe. Below it, a grid of cards
   from `screenshots`: each card should include the matched image from `omnisight-images/`, the subject name,
   the location/metadata line, and the description prose, with a "show more"/"show all" control if there are
   many.

### IntelEngine tab — sections

1. **The Great Powers** — the `relations`, rendered as **bars that slide along a track**:
   - Sort the rows by score **ascending** (most hostile / the war at the top).
   - Each row is a grid: **faction A name** (right-aligned, coloured by faction, with its leaders + seat
     shown on hover) · a **track** (a thin full-width rule with a centre tick at 0) · **faction B name**
     (left-aligned, coloured, with an inline **"⚔ At War"** tag when the pair is at war) · the **score** on
     the far right (coloured by sign: red negative / green positive / dim zero).
   - On the track, a **colored bar segment slides from the centre to the score position**: negative scores
     extend **left in blood-red** (hostility); positive scores extend **right, tinted by faction A's
     colour** (alliance). Width ∝ |score|/100 of each half.
   - Flag any at-war pair (e.g. a subtle red glow on the track).
   - Caption in the spirit of: *relations from −100 (open war) to +100 (alliance); each pair drifts as the
     world generates off-screen politics; hover a name for its leaders and seat.*

> **Sections 2–3 are conditional on there being a war.** If the data has no war (see Step 2), **omit both
> the war panel and the battles list entirely** — no empty panel, no "no war found" placeholder — and let
> the remaining IntelEngine sections renumber so the tab reads naturally (Relations, then Provocations, then
> Whispers).

2. **The War** *(only if a war exists)* — a panel for the active
   `war`: an intro note (who declared it and when, battles fought so far, victor status), then the two
   belligerents either side of a `Versus`, each with **morale** and **strength** gauges (0–100 bars) and
   their leaders.
3. **Battles** *(only if a war exists)* — `battles` rows: location, attacker/defender, result, each side's
   losses, and the narrative.
4. **Chronicle of Provocations** — `events` rows in time order: an event-type tag, the description, the
   faction pair, and the signed `relation_delta` (red for negative, green for positive).
5. **Whispers Beyond the Road** — the `gossipdata` as a **responsive card grid**. Above the grid, a row of
   **summary stat blocks** (total recorded whispers, distinct voices involved, political count, player-rumor
   count) and a row of **filter chips**. Each **card** shows:
   - one or more **colour-coded category tags** (see classification below), and a top border tinted to the
     card's category;
   - a **speaker → listener** header (uppercase, the listener in the accent colour);
   - the **scene** as **capitalized italic context ending in a colon** (take `narration`, capitalize the
     first letter, strip trailing punctuation, append `:`);
   - the **rumor as a pull-quote** anchored at the card's foot (larger serif, a left accent rule, a
     decorative quotation mark).

   **Classify each whisper** (at render time, by scanning the rumor text) into:
   - **About the player** *(gold tag)* — references the player character (by name, an alias/epithet, or a
     closely associated NPC).
   - **Political** *(steel tag)* — references factions, leaders, war, tariffs, named political locations, or
     related terms.
   - **Personal** *(green tag)* — everything else.

   The chips are **All** + those three buckets, each showing its count. Derive the matching terms from the
   data (the player's name from `uuid_mappings`; faction names/leaders/holds from IntelEngine +
   `political_state.json`) rather than hardcoding any character. If no log was uploaded, hide this section
   and note why.

### Beyond the standard layout

The sections above are the standard build, but my save is my own. If, while reading my data, you find
something **genuinely notable that none of those sections capture** — a significant world event, a completed
quest arc, a dragon-soul or bounty milestone, a distinctive populated table — **don't silently drop it, and
don't cram it into an ill-fitting section.** Tell me what you found and **ask whether I'd like a new section
built for it.** If I say yes, design it in the same aesthetic (roman-numeral header, the shared palette and
fonts, its own JSON payload, collapsible like the rest) and add it to the appropriate tab and the table of
contents. Only add sections I've approved — never invent one unprompted.

### Footer

A short italic footer naming the source database files (use the actual uploaded filenames) and noting that
off-screen gossip is reconstructed from the saved model outputs.

---

## Phase 4 — Verify before you hand it over

- Confirm the build opens offline; **run it / render it** (a headless browser is ideal) and check every
  section populates (no empty panels, no `undefined`, no `NaN`, no console errors — a blocked Google Fonts
  request offline is expected and fine). If OmniSight image embeds were requested, confirm the supplied image
  files are present in `omnisight-images/` and render in the cards.
- Confirm every interaction works: tab switching; UMAP/PCA toggle; actor / type / sort filters and the live
  count; diary flip; OmniSight show-more; whisper filters; **every section collapses and re-expands**; and
  the **Constellation's actor chips stay visible and keep filtering the memory list while that section is
  collapsed**.
- Confirm the layout is clean: **no horizontal overflow** at desktop and mobile widths; on desktop the
  **floating TOC never overlaps the content** and the content **re-centers on wide screens**; on narrow
  screens the **mobile TOC bar + hamburger overlay** work.
- Confirm the character name, day count, "The Adventures of …" title, and every stat came from **my** data —
  not from any example — and that the OmniSight summary is grounded in my actual captures.
- Tell me plainly what you had to fall back on (e.g. "UMAP not installed, used t-SNE", "no log provided,
  gossip omitted", "no OmniSight images provided, used text-only capture cards")
  rather than papering over gaps.
- Then give me the finished `.html` file.
