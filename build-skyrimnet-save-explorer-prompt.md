# SkyrimNet Save Explorer — Build Prompt

> Copy everything below the line into a fresh Claude conversation. Claude will walk you through
> uploading your save data one file at a time, then build a single self-contained HTML page that
> visualizes your playthrough.

---

You are going to build me a **SkyrimNet Save Explorer**: one self-contained, offline HTML file that
turns my Skyrim AI-mod playthrough (the **SkyrimNet** and **IntelEngine** mods) into an elegant,
interactive "save explorer" web page. Think of it as an illuminated field journal for a single
character's run.

The finished page has **two tabs**:

- **SkyrimNet** — my character's lived experience: an event timeline, an interactive "constellation"
  of their memories, the memories themselves, a kill ledger, a diary page, and OmniSight field notes.
- **IntelEngine** — the political layer: faction relationships, the ongoing war, its battles, a
  chronicle of provocations between factions, and off-screen gossip.

**Do not build anything yet.** First collect my files, one at a time, following the protocol below.
Everything about the page — the character's name, the number of in-game days, every count and label —
must be **derived from my uploaded data**. Nothing is hardcoded from any example.

---

## Phase 1 — Collect the files (one step at a time)

Ask me for **one file at a time**, in the order below. After each upload, **inspect the file and tell me
what you found** (row counts, the character's name, the date range, anything missing) before asking for
the next one. Wait for each upload — do not ask for everything at once.

The databases are **SQLite**. Inspect them with Python's built-in `sqlite3` module (the `sqlite3` CLI may
not be available). Run read-only queries only — never modify my files.

### Step 1 — the SkyrimNet database

Ask me to upload my **SkyrimNet database** — a file named like `SkyrimNet-<numbers>.db`.

When it arrives, read its schema and confirm the tables below exist and how many rows each holds. This DB
is the source for the entire **SkyrimNet tab**:

- **`memories`** — first-person memories. Columns you'll use: `content` (the memory text), `actor_uuid`,
  `location`, `game_time` (a float in-game clock), `importance_score` (~0.5–0.85), `emotion`,
  `memory_type` (e.g. `EXPERIENCE`, `RELATIONSHIP`, `KNOWLEDGE`, `TRAUMA`), `tags` (JSON array),
  `related_event_ids` (JSON array).
- **`memory_embeddings`** — one row per memory: `memory_id`, `embedding` (raw vector bytes), `dimension`
  (e.g. 384). These power the "Constellation" scatter. **Decoding gotcha:** the value is served as TEXT,
  not BLOB, so set `con.text_factory = bytes` before reading — otherwise Python's sqlite3 tries to
  UTF-8-decode it and will either throw ("Could not decode to UTF-8") or report a wrong `LENGTH()`
  (character count of mangled multibyte text, not real byte count). With `text_factory = bytes`, each
  value is exactly `dimension × 4` bytes (384 → 1536) of little-endian IEEE-754 float32, no header, no
  compression — see the projection recipe in Phase 2.
- **`events`** — the full event log (often 1000+ rows). Columns: `event_type`, `event_data` (JSON),
  `location`, `game_time`, and **`game_time_str`** — a human date like
  `"7:45 AM, Middas, 20th of Last Seed, 4E 201"`. This drives the day timeline and (via `death` events)
  the kill ledger.
- **`uuid_mappings`** — maps the big numeric `uuid` values to a readable `actor_name`. Use it to turn
  every `actor_uuid` / actor UUID into a name. **The player character's name comes from here** (the
  actor flagged as the player, e.g. bio template `player_special`).
- **`omnisight_screenshots`** — captured location/scene notes: `subject_name`, `description` (rich prose),
  `location_cell`, and a `capture_time_game` date. (The actual screenshot pixels are **not** in the DB
  logs; use the text + metadata.)
- **`diary_entries`** — long-form first-person journal `content` with an `emotion` and `entry_date`.

Tell me the character's name and the in-game date span you detected, then proceed.

### Step 2 — the IntelEngine database

Ask me to upload my **IntelEngine database** — a file named like `IntelEngine-<numbers>.db`. This is the
source for the **IntelEngine tab**. Confirm these tables:

- **`faction_relations`** — pairwise standings: `faction_a`, `faction_b`, `relation_score` (−100…+100),
  `war_active`, `trade_active`.
- **`faction_wars`** — active/past wars: `faction_a`, `faction_b`, `battles_fought`, `faction_a_morale`,
  `faction_b_morale`, `faction_a_strength`, `faction_b_strength`, `victor`.
- **`war_battles`** — `location_name`, `attacker`, `defender`, `result`, `attacker_losses`,
  `defender_losses`, `narrative`.
- **`faction_events`** — provocations/incidents: `faction_a`, `faction_b`, `event_type`
  (e.g. `war_declaration`, `border_skirmish`, `espionage`, `assassination_attempt`), `description`,
  `relation_delta` (a signed integer), `game_time`.

If I also happen to have a small **`political_state.json`**, use it for **faction identity** — display
names, leaders, and holds — which give you readable faction labels for the relations/chronicle sections. It
also mirrors the current war/relations state as a convenience, but the IntelEngine DB is authoritative for
the numbers.

### Step 3 — the SkyrimNet logs

Ask me for my **SkyrimNet logs**. Explain what each log offers so I can upload the right one(s), and pick
whichever you actually need rather than demanding all of them:

- **`openrouter_output.log`** (~1 MB — *recommended*) — the model's structured outputs. This is the only
  source for the **gossip** section and a good source for diary/OmniSight text.
- **`conversation_log.log`** (~78 KB) — the raw player↔NPC / NPC↔NPC dialogue transcript.
- **`openrouter_input.log`** and its dated siblings (~4–13 MB each) — mostly the *prompts* sent to the
  model; large and largely redundant with the DBs. Usually **skip these** unless you find you need the
  request-side context; they may be too big to upload.

These logs are **not** JSON-lines. Each entry is a header line followed by a body. Split on the header
pattern:

```
^\[.*\] \[.*\] (Generate request|Generate response|GenerateStreaming complete response) \[req_.*\]:
```

then JSON-parse the block that follows (guard for plain-text and ```json-fenced bodies). **Discard** the
startup health-check pings that read `"Hello! Yes, I'm working"`.

The block I care about most is category **`intel_story_dm`**, which yields gossip objects like:

```json
{ "type": "npc_gossip", "npc": "Arivanya", "npc2": "Ulundil",
  "narration": "leaned close and murmured about the Stormcloak uproar...",
  "gossip": "Ulfric called Thalmor justiciars parasites on Nord soil — loudly, in the square" }
```

`npc` is the speaker, `npc2` the listener, `narration` the scene, `gossip` the rumor. (Some are
`type:"npc_interaction"` with `fact1`/`fact2` instead — you may include those as memories exchanged.)

**If I don't provide logs, don't invent gossip** — hide or annotate that section and tell me it was
skipped for lack of a log file.

---

## Phase 2 — Transform the data

Build three JSON payloads to embed in the page. Derive everything from my files.

### SkyrimNet payload (`sndata`)

- **`stats`** — headline numbers for the header: total events, total memories, number of distinct minds
  (actors that have memories), OmniSight captures, and total spend (sum `gold_spent`/`net_gold` from
  `trade_*` events if present). Also a one-line subtitle (character name + the in-game date span, and
  playtime hours if derivable from `playtime`).
- **`events_by_day`** — a map keyed `"<in-game day label>|<event_type>" -> count`. Parse the day/date out
  of `events.game_time_str` (e.g. `"20th of Last Seed"`), and count events per `(day, event_type)`. The
  page buckets `event_type`s into five categories — build the same mapping:
  - **Dialogue** (gold): `dialogue`, `dialogue_background`, `dialogue_npc`, `dialogue_player`,
    `dialogue_player_stt`, `dialogue_player_text`, `gamemaster_dialogue`
  - **Death & combat** (blood red): `death`
  - **Thoughts & narration** (steel blue): `player_thoughts`, `direct_narration`, `diary_entry_created`
  - **Trade, rest, world** (moss green): `trade_start`, `trade_complete`, `sleep_start`, `sleep_stop`,
    `book_read`, `furniture_used`, `item_given`
  - **Followers & tasks** (grey): anything else
- **`memories`** — an array; for each memory: `content`, `actor` (resolved name via `uuid_mappings`),
  `emotion`, `location`, `imp` (= `importance_score`), `type` (= `memory_type`), `day` (from its
  `game_time`/related event), and 2-D coordinates `x, y` and `ux, uy` (below).
- **`edges`** — an array of `[i, j, similarity]`: for each memory, its **2 nearest neighbors** by cosine
  similarity in the full embedding space, with the similarity value.

**Computing the projection (`x,y` / `ux,uy`) and edges** — do all of this offline in Python; the browser
only ever receives coordinates, edge indices, and similarity weights, never the raw vectors:

1. **Decode.** Open the DB with `con.text_factory = bytes`. Join `memory_embeddings` to `memories` on
   `memory_id` and decode each embedding with `np.frombuffer(blob, dtype=np.float32)`. Expect
   `len(blob) == dimension * 4` (384 → 1536). If lengths are `dimension × 2` it's float16; anything
   smaller/irregular suggests a compressed store — but standard SkyrimNet DBs are plain float32. Stack into
   an `N × dimension` matrix **in memories order**, so row *i* is memory *i* everywhere downstream
   (tooltips, filters, and edges all index this one shared array).
2. **PCA → `x,y`.** Mean-center the matrix and take the top-2 principal components via SVD (top two singular
   vectors scaled by their singular values). Report the fraction of variance those two components capture
   (sum of top-2 squared singular values / total) in the section caption — usually ~20%, an honest "blurry
   linear shadow" of the space.
3. **UMAP → `ux,uy`.** Run UMAP on the same matrix with **`metric='cosine'`**, `n_neighbors=10`,
   `min_dist=0.15`, and a fixed `random_state` for a reproducible layout. Cosine is deliberate — it's the
   metric the mod's memory recall actually uses, so UMAP preserves the neighborhoods recall operates on. If
   `umap-learn` isn't installed, fall back to cosine t-SNE; failing that, reuse the PCA coords for `ux,uy`.
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

- **`relations`** — from `faction_relations`: each pair with its signed `relation_score` and whether a war
  is active.
- **`war`** — from `faction_wars`: the belligerents, `battles_fought`, and both sides' morale & strength.
- **`battles`** — from `war_battles`: location, attacker/defender, result, losses on each side, narrative.
- **`events`** — from `faction_events`: the provocation chronicle — faction pair, `event_type`,
  `description`, signed `relation_delta`, ordered by `game_time`.

### Gossip payload (`gossipdata`)

An array of `{ speaker, listener, rumor, scene }` from the successful `npc_gossip` records in the
`intel_story_dm` log blocks (`speaker`=`npc`, `listener`=`npc2`, `scene`=`narration`, `rumor`=`gossip`).
Keep only **distinct** exchanges (dedupe repeats). Empty if no log was provided. Displayed gossip must come
**only** from these saved outputs — the dialogue/input logs are corroborating provenance (the rule that
every rumor traces to real in-world information), not a source of new rumors.

---

## Phase 3 — Build the page

Produce **one self-contained `.html` file**. No build step, no frameworks, no external JavaScript or CSS
libraries. The only external reference allowed is a Google Fonts `<link>`. Embed the three payloads as
`<script type="application/json">` blocks and render everything with **vanilla JS**. It must open by
double-clicking the file offline.

### Look & feel (Skyrim illuminated-manuscript aesthetic)

- **Fonts:** `Oswald` (uppercase, letter-spaced headings/labels), `Crimson Pro` (serif body),
  `JetBrains Mono` (numbers/metadata).
- **Palette (CSS `:root` variables):**
  `--bg:#14161a; --panel:#1a1d23; --text:#e8e4da; --dim:#98938a; --gold:#c9a45c; --steel:#7da3b8;
  --blood:#b0584e; --moss:#8ba06b;` plus subtle hairlines like `rgba(232,228,218,.16)`.
- **Motifs:** centered header (small gold eyebrow label, large thin character name, italic subtitle, a row
  of stat blocks divided by thin rules); "double rule" horizontal dividers; section headers as roman
  numerals + uppercase title with a trailing hairline; a **floating table of contents** pinned to the side
  (collapsible on narrow screens). Fully responsive; honor `prefers-reduced-motion`.
- Two **tabs** at the top (`SkyrimNet` / `IntelEngine`) that swap the visible content and the TOC.

### SkyrimNet tab — sections

1. **The Timeline** *(e.g. "Five Days in Whiterun Hold")* — one vertical stacked bar per in-game day, each
   segment a category colored per above, bar height ∝ that day's event count, with a day label + total and
   a color legend. Built from `events_by_day`.
2. **Constellation of Memory** — an SVG scatter of every memory (`sndata.memories`). Position from the
   projection; **dot size ∝ importance**; **color by actor** (top ~5 actors get distinct colors, the rest
   grey). Draw `edges` as faint lines (opacity ∝ similarity). Interactions: a **UMAP/PCA toggle** (updates
   positions and the caption), **actor filter chips** (All / top actors / Everyone else) that dim
   non-matching stars, **hover tooltips** showing the memory text + meta, and **draggable stars** with a
   light spring simulation (home-spring + edge-spring + damping) so neighbors tug along. If reduced motion
   is set, place stars statically.
3. **The Memories Themselves** — the memories as a list grouped by day: actor + emotion on the left, the
   text (with location) in the middle, an **importance bar** on the right. The same actor/type filters
   apply here.
4. **Blood Ledger** — kills parsed from `events` where `event_type = 'death'` (killer/victim from
   `event_data`). Show killer → victim rows, or an aggregated leaderboard by killer, as horizontal blood-
   red bars with counts. Resolve names via `uuid_mappings` where needed.
5. **The Diary** — render `diary_entries.content` as a centered "journal page" (bordered panel, drop-cap
   first letter, italic place/date header). If several entries exist, show them in order.
6. **OmniSight Field Notes** — a grid of cards from `omnisight_screenshots`: subject name, location/metadata
   line, and the description prose, with a "show more" control if there are many. Text only (no images).

### IntelEngine tab — sections

1. **The Great Powers** — `relations` rows: faction A vs faction B with a **centered ± bar** (negative to
   the blood side, positive to the gold/moss side) and the numeric score; flag any pair at war.
2. **The War** — a panel for the active `war`: the two belligerents with `vs`, plus **morale** and
   **strength** gauges for each side and the battle count.
3. **Battles** — `battles` rows: location, attacker/defender, and each side's losses with the narrative.
4. **Chronicle of Provocations** — `events` rows in time order: an event-type tag, the description, the
   faction pair, and the signed `relation_delta` (red for negative).
5. **Whispers Beyond the Road** — `gossipdata`: speaker → listener → rumor rows, with the scene in italics
   beneath. **Classify each whisper** (at render time) into one of three buckets and show a summary count +
   filter chips for each:
   - **About the player** — references the player character (by name, an alias/epithet used for them, or a
     closely associated NPC).
   - **Political** — references factions, leaders, war, tariffs, named political locations, or related terms.
   - **Personal** — everything else.

   Derive these terms from the data (the player's name from `uuid_mappings`; faction names/leaders/holds
   from IntelEngine + `political_state.json`) rather than hardcoding any character. If no log was uploaded,
   hide this section and note why.

### Footer

A short italic footer naming the source database files (use the actual uploaded filenames) and noting that
off-screen gossip is reconstructed from the saved model outputs.

---

## Phase 4 — Verify before you hand it over

- Confirm the file is self-contained and opens offline; **run it / render it** and check every section
  populates (no empty panels, no `undefined`, no console errors).
- Confirm the character name, day count, and every stat came from **my** data — not from any example.
- Tell me plainly what you had to fall back on (e.g. "UMAP not installed, used t-SNE" or "no log provided,
  gossip section omitted") rather than papering over gaps.
- Then give me the finished `.html` file.
