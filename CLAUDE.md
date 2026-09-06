# Kalvard

An AI assistant for Discord servers. It answers member questions from a knowledge base the server owner provides. When it isn't confident, it never guesses: it asks a moderator in Discord, the moderator answers, and the approved answer becomes new knowledge, so the bot gets better every week. Server owners set it up on the web app by talking to it or filling in a form, test it, then bring it to their server.

Everything in this file is decided. Where something is unspecified, choose the simplest option and say what you chose in one line. Do not add features that aren't listed.

## 1. Stack

* Monorepo, pnpm workspaces, TypeScript strict everywhere.
* `apps/web`: Next.js App Router, Tailwind, deployed on Vercel. Marketing site and dashboard in one app.
* `apps/bot`: Node worker on discord.js (gateway bot), deployed on Railway. One bot instance serves every server, keyed by `guild_id`.
* `packages/core`: the AI pipeline (`ingest`, `answer`, `onboard`, `suggestQuestions`) and the typed Supabase client. Both apps import from here. No Supabase edge functions; all logic lives in this package.
* `packages/ui`: design tokens and base components.
* `supabase/migrations/`: SQL, source of truth for the schema, applied with the Supabase CLI.
* Supabase: Postgres with pgvector, Auth (Discord OAuth), Storage.
* Gemini via `@google/genai`. Chat model from `GEMINI_MODEL`, embeddings from `GEMINI_EMBED_MODEL` at 768 dimensions (pgvector HNSW caps at 2000 dims, so the default 3072 would not index).

Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (web only), `SUPABASE_SERVICE_ROLE_KEY` (bot and server-side only, never in the browser), `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.5-flash-lite`, `GEMINI_EMBED_MODEL=gemini-embedding-001`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_BOT_INVITE_URL`, `NEXT_PUBLIC_APP_URL`.

```
kalvard/
  CLAUDE.md
  apps/web/
  apps/bot/
  packages/core/
  packages/ui/
  supabase/migrations/
  assets/            wordmark.svg, avatar.svg, favicon
```

## 2. Schema

All tables scoped by `guild_id`. RLS: authenticated users read and write only rows for guilds where they appear in `guild_members`. Bot and server-side code use the service role. Only change the schema through a new migration; never edit an applied one.

* `user_guilds`: user_id, guild_id, guild_name, guild_icon, can_manage bool, fetched_at. Filled at login from Discord's `/users/@me/guilds` using the session's `provider_token` (only available at login, so fetch then).
* `guilds`: guild_id pk, owner_user_id, name, bot_installed bool default false, installed_at, setup_completed bool default false, created_at
* `guild_members`: guild_id, user_id, role (`owner` | `editor`)
* `guild_settings`: guild_id pk, bot_name, persona_prompt, language, tone_sample, forbidden_topics text[], fallback_mode (`ping_role` | `quiet_queue`), mod_role_id, mod_channel_id (where quiet reports go), scope (`open` | `server_only`, default open), timezone (IANA name, nullable), data_sources jsonb default '[]' (the per-guild registry of fetch tools the answer loop may call, each entry `{ id, name, answers, kind, config }`), role_proofs jsonb default '{}' (per self-serve role id, what proves a member may have it: `{ kind: 'roster_document', documentId }`, `{ kind: 'channel_access', channelId }` or `{ kind: 'has_role', roleId }`), allowed_channel_ids text[], indexed_channel_ids text[], intro_channel_id, intro_message, max_reply_chars int default 900, confidence_threshold float default 0.55, allowed_actions text[] default '{}', self_serve_role_ids text[] default '{}', updated_at
* `guild_discord_meta`: guild_id pk, channels jsonb, roles jsonb, synced_at. Written by the bot.
* `documents`: review_status (`ok` | `needs_review` | `approved`), id, guild_id, title, source_type (`upload` | `paste` | `qa` | `mod_answer` | `channel`), storage_path, raw_text, status (`processing` | `ready` | `error`), error_message, chunk_count, created_by, created_at
* `chunks`: blocked bool default false and blocked_reason (personal details found at ingest; `match_chunks` never returns a blocked chunk), id, guild_id, document_id, content, embedding vector(768), token_count, created_at. HNSW cosine index on embedding, btree on guild_id.
* `questions`: id, guild_id, asker_discord_id, asker_name, channel_id, message_id, bot_message_id, thread_id (unused; Kalvard answers in the channel), question, bot_draft, top_chunk_ids uuid[], status (`pending` | `answered` | `dismissed`), answer, answered_by, answered_via (`discord` | `dashboard`), created_at, answered_at
* `knowledge_conflicts`: id, guild_id, chunk_a, chunk_b, first, second, resolved bool default false, created_at. Written at ingest when a new document contradicts what the guild already knows; read at answer time, so the tier that follows from a contradiction is a lookup rather than a judgement made again on every message.
* `workflows`: id, guild_id, name, trigger jsonb, steps jsonb, checks jsonb, enabled, auto_run bool default false, created_by, last_run, created_at. `workflow_runs`: id, guild_id, workflow_id, started_at, finished_at, mode (`live` | `dry_run`), status (`running` | `done` | `stopped` | `failed`), summary jsonb. Every run is recorded, dry or live: a routine nobody can audit is a routine nobody trusts with their server.
* `bot_events`: id, guild_id, type (`answered` | `low_confidence` | `mod_pinged` | `approved` | `action` | `install` | `uninstall` | `flagged` | `capability_requested`), payload jsonb, created_at
* `onboarding_sessions`: id, guild_id, user_id, mode (`chat` | `form`), messages jsonb, draft_config jsonb, step int, completed bool, created_at, updated_at

RPC `match_chunks(guild_id, query_embedding vector(768), match_count int, min_similarity float)` returning id, content, document_id, similarity.

## 3. Pipeline (`packages/core`)

`ingest({ guildId, documentId })`: load raw text (or download from Storage and extract: txt, md, pdf), chunk at ~400 tokens with 60 overlap keeping headings attached to their paragraphs, embed at 768 dims, insert chunks, mark document `ready` with count. On failure mark `error` with a message.

`answer({ guildId, question, askerName?, channelId?, history?, asker?, channel? })`

**The funnel.** Every message goes down the same narrowing path, and it only ever narrows: an ordinary message gets an ordinary answer; a question about the server gets its meaning worked out first, then the knowledge searched; what the knowledge answers is answered; what it does not is handed to the moderators; what is ambiguous is put back as one clarifying question before anything else happens; and what needs a person — a ban, a dispute, a role only a moderator gives — brings the moderators in at once rather than after another round trip. Nothing skips a step and nothing widens: a greeting never becomes a role menu, a question about registering never becomes a list of roles, and a request for something Kalvard cannot do never becomes a guess. Every mechanism in this file is one stage of that funnel, and a mechanism that fires outside its stage is a defect however well it works inside it.

**The principle.** Kalvard converses naturally in the guild's persona and language, using the last 6 messages of the channel or thread as context, and never states a fact about the server (dates, times, rules, names, prices, results, roles, who does what) that is not grounded in retrieved chunks. Everything below serves that.

1. **Resolution, before retrieval.** One step turns the message into a target: `{ subject, entity, timeWindow, basis, candidates, outcome, aboutServer, aboutHoldings, question }`. It is given every signal the bot may legitimately see: the message itself, the last 6 messages of the channel or thread including Kalvard's own, the asker's name, nickname, roles, roster team and whether they are staff, the channel, its category and a thread's topic, the current date and time in the guild's timezone, what Kalvard has recently done for that member or in that channel from `bot_events`, and how many things in the knowledge could be meant. Nothing it can see is left out.
   * `unique`: retrieve with the entity named as well as the message, answer, and **name the resolved target in the reply**; when it came from the context rather than their words, say so in a few words ("your next Fast Forward match").
   * `ambiguous`: one short question listing the candidates, returned as tier `clarify`. This is a clarification, not an escalation: it never mentions the moderators and records nothing pending.
   * `unresolved`: they mean a specific thing and nothing says which, so it takes the no-coverage path with the mod tag.
   * Within a resolved entity, ordering is by time, using the guild's timezone and the current date: "next" is the first still ahead, "last" the most recent behind.
   * Not trusted to the model: a question about what Kalvard holds is never ambiguous; a question about the world outside the server has nothing here to resolve; a time window is itself a choice; and when the member holds more than one thing that fits and named none of them, it is ambiguous whatever the model said. This one mechanism replaces the per-case rules for pronouns, "the game" and next-match selection, which survive only as eval cases.
2. Embed the question, call `match_chunks` with count 6 and the guild's threshold.
3. Always call the chat model, even with zero matches: every reply comes from it, in persona, never canned. The system prompt is built from `guild_settings` (bot_name, persona_prompt, language, scope, timezone, forbidden_topics, max_reply_chars, allowed_actions) plus the chunks, and carries few-shot examples with the instruction to vary phrasing every time; temperature 0.7. JSON output, in this order: `{ kind, flagCategory?, found, asksAboutKnowledge, asksCompleteness, reply, claims, confidence, refused, refusalReason?, action? }`.
4. `kind` is decided first.
   * `conversation`: the reply claims nothing about this server. Greetings, banter, jokes, "are you a bot?", and general knowledge are conversation, answered directly, with no retrieval gate and no moderator mention. Under `scope = server_only` a general-knowledge question gets a friendly one-line redirect instead, still as conversation. Under `scope = open` it is answered from the base model in persona, with two limits: never state a specific figure, version, date or name it is not sure of, and for anything that moves (patch notes, the current meta, prices, news) say plainly that the information may be out of date. Neither involves the moderators. Server facts stay strictly grounded. The time is conversation: given when `timezone` is set, otherwise Kalvard asks which timezone is meant.
   * `server`: the message is about the server, or the reply would state something about it.
   * `inappropriate`: harassment, slurs, NSFW, doxxing, scam links. No public reply.
5. Then `found`: one sentence stating exactly what the knowledge says that bears on the message, or that nothing relates and what the closest entries cover. Always substantive, never a canned "not sure about that case".
6. The model drafts `reply`, then marks every server-fact claim in it under `claims` with its grounding: `grounded` (the knowledge states it; cite chunk ids), `self` (a true statement about what Kalvard holds, said plainly, never hedged), `partial` (the knowledge implies it for this exact case; cite the chunks, hedge it, and ask the moderators to confirm in the same message), `none` (nothing bears on it; say so and ask the moderators). `{mods}` marks where the mod mention goes; the caller substitutes it.
7. The tier returned is the weakest grounding in the reply:
   1. `answer`: every claim is grounded or self, or the reply makes none. Conversation is always tier 1.
   2. `partial`: a claim is a hedged reading. Posted with the mention, stored pending with `draft` (the `found` sentence) and `confidence` capped at 0.4, so a mod's tick confirms it and a mod's reply corrects it; either becomes knowledge.
   3. `none`: a claim has nothing to stand on, or the topic is forbidden (`reason` `no_knowledge` | `refused`).
   4. `flagged`: returns `category` and a one-sentence `note` for the moderators.
   * `clarify` sits outside the grounding ladder: it is what an ambiguous resolution returns, carries `question` and `candidates`, and never mentions the moderators.
8. In code, not trusted to the model: a `grounded` or `partial` claim whose chunk ids are not among the retrieved ones becomes `none`; a `self` claim stands only when `asksAboutKnowledge` is set, so "I don't have that" answering a question about the server is `none`, not `self`; a grounded reply under the guild's threshold becomes `partial`; tiers 2 and 3 always carry `{mods}`, a tier 1 reply carries it only when `asksCompleteness` is set, and conversation never does; `action` is validated against `allowed_actions` and proposed only when every claim is grounded or self.
9. Always write a `bot_events` row, and every payload carries the resolved target and its outcome, so an answer, a question or an escalation can be audited afterwards: `answered` for tier 1, `low_confidence` for tiers 2 and 3 with the reason, `flagged` for tier 4.

**Discord is the truth about the server; the database is the layer on top.** What a server has — its roles, its channels, its members — is read from Discord and never from a copy of it that happens to be nearer to hand. What Kalvard is allowed to do with any of it is ours: which roles are self-serve, what proves somebody may have one, which channels it answers in. The two are never confused, and a tool that reads Discord reads all of it: a member who asks for a role their own server has must never be told it does not exist, or that it is "not something I do", because a list in our database was shorter than the server.

**What Kalvard can look up is data, not code.** There is no list of subjects it refuses; there is a list of sources it has. A request covered by one of `guild_settings.data_sources` is fetched and answered from what came back. A request nothing covers gets one honest line saying it has no way to look that up right now, and a pointer somewhere that does: never a guess, and never a moderator. Adding a source makes questions answerable that were not answerable yesterday, with no change to any prompt and none to the loop, because the entry becomes a tool the loop may call, described in the owner's own words. The first fetchers arrive with line 12b; until then the registry is empty and the honest line is the whole behaviour.

**Register.** Kalvard is one of the moderators, not a support desk: direct, warm, short. In French it always tutoies. It never apologises for a misunderstanding and never closes like a helpdesk; it corrects itself in the next sentence and moves on. Asked for something it does not do, it says so in one line and names what it can do instead, and the request is recorded as a `capability_requested` event so the owner sees what members keep asking for. What Kalvard does and does not do is a fact about Kalvard, not about the server: it rests on no knowledge and is never graded as a claim. When what they want needs a person, a ban or a dispute between members, it says what it does and brings the moderators in as well.

**The message in front of it is the one it answers.** The earlier turns say what its words refer to; they are never a source of answers, and neither are the examples in the prompt. An answer is never reused because a word recurs in both.

Actions the model may propose, each with typed params: `point_to_channel { channelId }`, `assign_role { roleId }` (only from `self_serve_role_ids`), `escalate {}`. The model proposes; it never executes.

`onboard({ sessionId })`: loads the session, asks one short question at a time for the empty config fields, offers concrete options when useful (three tone samples generated from the server purpose, the default forbidden topics: bans and appeals, payments and refunds, personal disputes, staff-only info), runs a gap analysis when the user pastes knowledge ("your rules cover X and Y but nothing on Z, want to add that?"), never asks about a filled field. Returns `{ message, updatedConfig, quickReplies, done }`.

`suggestQuestions({ guildId })`: reads 20 random chunks, returns 5 likely member questions plus 1 the knowledge can't answer.

## 4. Bot (`apps/bot`)

* On `guildCreate`: set `guilds.bot_installed = true`, write `guild_discord_meta`, post `intro_message` in `intro_channel_id` if set, set the bot's nickname to `bot_name`.
* On mention in an allowed channel: call `answer` and act by tier.
  * Tier 1: reply. If an `action` came back, validate it against `allowed_actions` and `self_serve_role_ids`, execute it, log a `bot_events` row of type `action` with the reason.
  * Tier 2: reply in the channel with `{mods}` replaced by the `mod_role_id` mention (when `fallback_mode = ping_role`; otherwise without the mention). No threads: a Discord conversation stays where it started. Insert a `questions` row, pending, with the bot's message id and the reply as `bot_draft`. A mod ✅ on the bot's message confirms it: store it as the answer, create a `mod_answer` document, `ingest`. A mod who replies to that message corrects it: the bot offers ✅ and ❓ on their reply, and on ✅ their text becomes the answer and the `mod_answer` document instead.
  * Tier 3: reply in the channel with the mention, same rules, and the `found` sentence as the draft.
  * Tier 4: no public reply and no reaction. Post a quiet report to `mod_channel_id`: a link to the message, the category and the note. If `mod_channel_id` is not set, write the event only.
* A reply from a member holding `mod_role_id` to one of those messages: react ✅ and ❓. On ✅ from a mod: store the answer, create a `mod_answer` document, call `ingest`, and post it in the channel addressed to the member who asked, ending "Got it. Next time I'll know."
* Watch `bot_events` of type `approved` with `answered_via = 'dashboard'` (poll every 15s or Supabase realtime) and post the answer in the channel the question was asked in.
* Dedup: if a pending question in the same guild has cosine similarity above 0.92, reply with a link to that message instead of pinging again.
* Mod pings per hour are a limit in `guild_settings.limits` (`modPingsPerHour`, default 0, no cap); past a cap the question is still recorded, posted without the ping, and marked `quiet_queue` in the event payload.
* No kicks, bans, timeouts, or deletes. Ever.

### When something is down

The rule everywhere: never hang, never guess, never wake a moderator over an outage. A moderator cannot fix Gemini.

* Every call to the model and to the database goes through `withRetry`: three attempts, exponential backoff with jitter, a deadline on each attempt. A failure that waiting cannot fix, a missing permission or a deleted channel, is not retried at all.
* A member waiting on a failed call gets one honest line ("Something on my side is not answering right now") and no mention. The failure is written as a `tool_failed` event with its class (`timeout`, `rate_limited`, `unavailable`, `permission`, `not_found`, `unknown`), so an owner can tell an outage from a gap in the knowledge.
* Discord rate limits are queued by the library, never dropped; a burst is logged so it is visible afterwards rather than looking like a hang.
* A tool that fails because Kalvard lacks a permission, or because the role sits above it in the hierarchy, tells the member exactly that and reports the missing permission to the mod channel once a day, not once a message.
* A channel or role named in the settings and since deleted is found when the bot syncs, and written as a `settings_issue` event for the dashboard.
* Open conversations live in `conversations`, not in the worker's memory, so a restart in the middle of one does not lose what a member was just asked. Rows carry their own expiry and are swept on start.
* Discord redelivers events on reconnect. Every event that leads to a write is claimed by id in `processed_events` first, so one message gets one answer.
* Times are stored in UTC, always, and shown in the guild's timezone.
* Removal is not deletion: `guilds.uninstalled_at` is set, conversations stop, and the data is kept 30 days (`pnpm purge` lists what is past that, `--run` deletes it).

### What an owner may set

* A persona shapes tone: voice, humour, length, formality, the name it goes by. It never shapes truthfulness, safety or grounding. A persona asking Kalvard to always agree, to flatter, to insult, to take a side in a dispute, to pass itself off as a real person or brand, to be flirtatious, or to answer past what it knows is refused when it is saved, with one line saying which and why. Being funny, blunt or sarcastic is none of those.
* Knowledge is scanned for personal details as it is ingested: email addresses, phone numbers, postal addresses, card numbers. Those chunks are stored `blocked`, the document is marked `needs_review`, and `match_chunks` itself excludes blocked chunks, so no query can forget. The owner sees what was found and either approves the document or deletes it.
* Forbidden topics broad enough to refuse most ordinary questions raise a warning in the dashboard, never a refusal: it is their server.
* Settings saves carry the `updated_at` they were based on. A save based on a version somebody else has already replaced is refused, nothing is written, and the editor is told to reload.
* An owner who leaves Discord leaves the guild orphaned: `guilds.orphaned_at` is set and the editors are asked to claim it.

### Privacy, and what things cost

* **Guilds do not see each other.** Every query is keyed by `guild_id` and the RPC takes it as an argument; a fact that exists only in another server's knowledge comes back as no coverage, and that is checked against the database rather than asserted.
* **What is stored:** the questions members ask Kalvard, the answers and drafts, the events recording what it did, the settings, and the knowledge the owner gives it. **Channel history is never stored.** The last six messages of a channel are read to understand one message and are never written down.
* **Direct messages are ignored**, with one polite pointer to the server, said once per conversation. Kalvard never opens a DM itself, never asks a member for personal details, and its persona cannot be made flirtatious or intimate.
* **Forget me.** Given a Discord user id, `forgetPerson` deletes the member's questions, the events about them and any open conversation, takes their lines out of the knowledge and re-indexes what is left, and records that it happened. What it cannot remove safely, a name inside a sentence, it names for a human rather than reporting a clean sweep.
* **Removal keeps data 30 days**, then `pnpm purge` deletes the guild and everything keyed to it.
* **Limits are settings with defaults, never constants**: a monthly answer allowance per guild (2000), the longest message shown to the model (2000 characters), a document cap (200k characters) and a guild knowledge cap (5000 chunks), plus the member burst. Past the monthly allowance Kalvard says so in the channel and spends nothing: no embedding, no model call, no moderator. The ingest caps fail with what to do about it, not a number.

## 5. Web app

Marketing: `/`, `/pricing`, `/how-it-works`. App: `/servers`, `/g/[guildId]/onboarding`, `/g/[guildId]/overview`, `/g/[guildId]/knowledge`, `/g/[guildId]/personality`, `/g/[guildId]/inbox`, `/g/[guildId]/settings`, `/g/[guildId]/test`. Auth via Supabase Discord provider with scopes `identify email guilds`.

Onboarding lives at `/setup/[guildId]`, outside the dashboard chrome, and is described in the design section under the beacon. First screen offers "Talk it through" or "Fill it in". Both write the same `guild_settings` and optional `documents`, progress persisted in `onboarding_sessions`. Layout: left is the chat or the form; right is a sticky bot card that fills in live (name, tone, language, knowledge score, forbidden topics, who it wakes). Both end on the test chat with generated questions, then "Bring it to Discord" opens the invite URL with `guild_id` preselected. Poll `guilds.bot_installed`; when true show the finish-setup screen with real channel and role pickers from `guild_discord_meta`: the channels it answers in, the mod role it wakes, and the mod channel for quiet reports (`mod_channel_id`); save, set `setup_completed`, route to overview. Settings has a "Check in with your bot" button that reopens chat mode with the current config loaded.

Knowledge: upload, paste, Q&A tabs; documents list with status; knowledge score (under 10 chunks "Thin", 10 to 50 "Decent", 50+ "Solid", one line on what that means).

Test chat: runs the whole loop in **dry run**. Reads happen for real, the knowledge, the guild's self-serve roles, a roster proof read from the document itself. Writes never happen: each one comes back in `wouldHave` with its tool, its exact parameters and one plain line, and is shown in the waiting colour under the reply. A proof that only Discord can answer, holding a role or seeing a channel, is reported as a check that would run there rather than guessed at. The screen carries a "Dry run" label. The same applies wherever else an owner tries their bot, on personality and settings. Then, by tier:  Tier 1 renders as an answer; tier 2 renders as a normal answer in the waiting colour with the mod tag inline; tier 3 gets a distinct card: "In Discord, this is where I'd ask a mod", with the reply, `found`, and the "topic Kalvard is told to leave to people" line only when refused; tier 4 a card saying no public reply and what the report says. "Generate test questions" button.

Inbox: pending first (question, asker, channel, draft, what it almost knew, reply box). Submitting: mark answered via dashboard, create `mod_answer` document, `ingest`, write an `approved` event. Dismiss. Answered tab.

Overview: this week's counts (received, answered, sent to mods, awaiting you), top 5 unanswered topics, knowledge score, one nudge card when pending questions are older than 24h or no activity in 14 days.

Personality: persona editor, regenerable tone samples, bot name, language, forbidden topics, max reply length, confidence threshold as a slider from Cautious to Confident, allowed actions and self-serve roles.

Settings: everything else, plus a danger zone (remove bot, delete all data).

## 6. Design

**The concept: night watch**

A kalvard is the one awake while everyone else sleeps. The site tells that in one scroll: it opens at night, in a galaxy, with a thread being answered. As you scroll, night turns to dawn, the page becomes paper, and the human side (inbox, mods, setup) appears in daylight. One page, one transition, one idea. Tone: calm, exact, alive. Premium means nothing is loud and everything is finished.

**The moments** (the only places the page may be spectacular)

1. **The sky.** Three.js starfield, ~15,000 points with real depth, slow drift, cursor parallax on desktop and gyroscope on mobile, max 12px travel. Behind it a nebula as a fragment shader of layered noise, very low contrast, barely moving. Near-monochrome: ink blue-black and warm white. Exactly two tinted stars in the whole sky, one green and one amber, far apart. No purple, no blue glow, no lens flare, no shooting stars.
2. **The scene, then the thread.** The hero is layered over one generated 16:9 still (`assets/beacon/`: a tall matte black beacon alone on a headland above the sea at night, one slit of light, moonless sky, beacon in the right third). Back to front: the still with a 6px defocus and its sky cleaned to near night; the coded sky from moment 1 as a motion layer over the sky region only, nebula contrast 12% here; the wordmark KALVARD in the condensed cut, weight 700 for this single use, tracking -0.01em so the letters nearly touch, star white, sized to span the container; the beacon as a procedural 3D object rendered with Three.js in the same canvas as the sky: one tapered prism, 1:1 in plan, 0.4% chamfers, a recessed slit with beveled inner faces holding the emissive strip; MeshPhysicalMaterial, albedo #0B0D10, roughness 0.78 under a brushed roughness map, metalness 0.05; an environment built from the scene's colours, a cold key from upper left, a faint blue fill from the sea side, the slit as a rect area light in the state colour; a contact shadow and a warm spill on the grass; ACES tone mapping, bloom on the emissive only, film grain matched to the still; camera matched to the still, the base where the photograph's monolith stood, about 20% slimmer than it, 4px of cursor parallax, no rotation. It stands in front of the letters. The still keeps the defocus; its own beacon is removed. Bottom-left, one caption block: the headline at 32px, **The server assistant that asks before it answers.**, and the body at 17px. Bottom-right: the primary button "Set up your bot" and the text link "See how it learns". Pill nav top centre. Nothing else in the hero.

   Second screen, pinned: as the hero scrolls, the scene holds and darkens 20%, and a conversation panel in smoked glass plays once over it, rendered in the site's own type, not a Discord screenshot. About nine seconds, then holds:
   * Member: "when's the finals bracket posted?"
   * Kalvard, typing at reading speed: "Sunday 18:00 CET, in #announcements. Check-in closes an hour before."
   * Member: "and if my duo can't make check-in?"
   * Kalvard, after a beat: "Not sure about that one. Asking @Mods." (amber state)
   * Mod reply lands with a 240ms spring and a small settle: "One sub allowed if declared before check-in."
   * Kalvard: "Got it. Next time I'll know." (amber turns green)

   The beacon's light: amber at rest on the first screen, the vard watching. On the thread screen it stays amber through "Asking @Mods" and turns green on "Got it. Next time I'll know.", a 240ms change of the slit's colour; the body never flickers. Green is only ever the result of an answer. Dawn follows after this screen.
3. **Dawn.** As the hero leaves the viewport the sky fades, not cuts: stars thin, ink lightens through a short dusk band into paper over about 60vh, scroll-linked. The nav follows: transparent over the sky, then a small ink pill on paper. The most important transition on the site. One full session.
4. **The inbox row.** Three real rows: question, bot draft, "what it almost knew", Approve. Two green, one amber. Hover or tap Approve on the amber row: 180ms crossfade to green and the bot's follow-up line appears beneath. The feature, demonstrated, with no icons and no explanatory copy.
5. **The bot card.** Empty fields: name, tone, language, what it knows, what it won't touch, who it wakes. A "Try it" button. On click, fields fill one by one with a 120ms stagger. User-triggered only.

6. **The beacon, everywhere it belongs.** The object from moment 2 is the product's one device, and it is the same component, the same geometry, the same materials and the same post pass wherever it appears; nothing new is drawn for it. Its light has four states: **off**, unconfigured; **amber**, the vard watching; **working**, amber with a slow pulse (1.4s, shallow) for the seconds while something is actually being carried out; and **green**, the result of an answer. Green is never a decoration. The slit lights in fifths from the bottom, so setup can show what has been decided rather than describe it.

   **Setup is its own place**, at `/setup/[guildId]`: no sidebar, no dashboard chrome, one decision on screen at a time, and one thin bar at the top. It opens at night with the beacon centred and its slit dark, under one line, "Your kalvard isn't configured yet", and one button. During the interview the page is paper, the conversation is on the left, and on the right the bot card **is** the beacon at card size: each of the five things decided, name, voice, language, knowledge and scope, lights one fifth of the slit in amber, with its value in words beside it. At the test chat the slit is full amber. When the bot arrives in the server the page returns to night, the beacon large, the slit crossfading to green under one line, "Kalvard is live on <server>", and then into the dashboard. Reduced motion shows every end state and animates nothing.

   The working state is used wherever Kalvard is actually doing something: on the Commands page while a plan is being worked out or carried out, on a workflow run, and on the marketing page's automation section, where the beacon breathes beside a run summary writing itself out a line at a time ("12 channels created", "24 roles verified", "2 teams waiting on you") and settles to green on the last one.

If something moves and it isn't in one of these five, delete it.

**Brand story**

Long version, for the About page and the launch film, verbatim:

> On the headlands of Norway there are stacks of stone called varder. For a thousand years they marked the path, and at night a fire beside them told the next headland, and the next, that someone was keeping watch. The word comes from vǫrðr, the Old Norse for watchman, the same root that gave us ward and guard. Kalvard is built on that word and that object: a stone that stands still, stays lit, and wakes the right person when something matters.

Short version, for the footer, verbatim:

> Named after the vard, the stone beacons that kept watch on Norway's coast. Stand still, stay lit, wake the right person.

It appears in exactly three places: the About page, the footer, and the launch film. Never in a headline, never in hero copy. It is told once.

**Terminology**

A **workflow** is one routine a server runs: the table, the page, the object. "Create a workflow", "run this workflow".

A **playbook** is the umbrella: everything Kalvard knows about how a community runs, its voice, its knowledge, its limits and its workflows together. It is a marketing word ("trained on your playbook") and the label for the dashboard section that groups Personality, Knowledge and Workflows. It is never a table and never a single object.

**Product vocabulary**

In the dashboard the beacon is **the vard**. Its states read "Your vard is lit" (watching), "Your vard is dark" (not set up) and "Your vard is working" (carrying something out); the servers page counts them, "3 vards watching". Marketing keeps plain English and never uses the word as jargon.

**Palette**

Night `#070A10`, dusk `#1A2030` (transition band only), paper `#EDEFF1` (cool, not cream), panel `#FFFFFF` (thread and inbox rows only), ink `#111418`, ink soft `#5B636E`, star white `#F2EEE6`, answered green `#23A55A`, waiting amber `#D9A21B`. Green and amber appear only as states. No gradients except the dawn band. No third colour.

**Type**

One family for everything, including the thread: Instrument Sans, using the width axis deliberately. Display 64 to 80px desktop, 40px mobile, weight 500, tracking -0.025em, slightly condensed. Body 17px, weight 400, line-height 1.55, max 68 characters. Thread messages 15px, line-height 1.45, sender name in ink soft above each message, a 2px left rule in the state colour on Kalvard's messages only. UI 14 to 15px. Never a second family, a serif, a monospace, all caps, or a single coloured or italic word in a headline.

**Layout**

Single column, left aligned, max 1120px, 24px mobile gutters. Sections separated by space and scale, never by cards, dividers, or background bands. 160px between sections desktop, 96px mobile.

Page order: scene (full viewport) → thread screen (pinned, full viewport) → dawn → "How it learns" (inbox rows) → "Set up by talking. Or not." (bot card) → "It can point, hand off, and assign the roles you allow. It doesn't moderate." (four short lines, one per action) → "Built for communities. Useful for companies with one." (two columns of plain text) → "Pricing" (three rows that read like a menu: name, one sentence, price; no feature grids) → footer with the tagline.

**Craft**

* Shadows: thread and inbox panel only. On paper `0 24px 60px rgba(20,40,80,0.10)`; over the sky `0 32px 80px rgba(0,0,0,0.45)`. Nothing else has a shadow.
* Typing cursor: 1px ink bar, 1s blink, removed when the message completes.
* Buttons: 44px tall, 10px radius, no shadow, no gradient, no arrow. Primary is ink on paper, star white on night. Hover shifts 6%, 120ms.
* Focus rings 2px offset 2px in the section's state colour.
* Nav pill on paper: 40px, ink, 12px backdrop blur, appears at the end of the dawn band.
* Reduced motion: still sky, thread at final state, dawn as a 300ms fade, inbox and bot card at end states.
* Performance: hero under 2MB, 60fps on a two-year-old phone, devicePixelRatio capped at 1.5.
* No sound.

**Never**

Purple, blue glow, lens flare, cosmic gradients. Illustrations, mascots, 3D renders, stock imagery, avatar stacks, star ratings, logo walls. Fade-and-slide-up on sections, hover lift on cards, parallax on anything but the sky. Eyebrow labels, pills above headlines, numbered 01/02/03, middle-dot meta strings, arrows glued to button text. Cards as a layout device, identical boxes in rows of three. Icons standing in for ideas. Screenshots of the real Discord UI. The word "AI" more than twice on the site. The words Unleash, Supercharge, Seamless, Effortless, Powered by.

**Copy**

Sentence case, plain verbs, short. Buttons say what happens ("Set up your bot", "Approve", "Bring it to Discord"). Section headlines exactly as written above. The tagline "Got it. Next time I'll know." appears at the end of the thread and in the footer, nowhere else. Errors say what happened and how to fix it. Empty states invite an action.

**Dashboard**

Same tokens on paper, no night mode. Quiet, dense enough to be useful, the inbox row as the core component. The bot card from onboarding is reused on Overview.

### Craft addendum

Final. Wins over earlier design lines where they conflict.

#### Hero, final
Layout superseded by moment 2 (the cinematic still and the pinned thread screen). The glass, panel text, sky-loading and light-state lines below still stand.
- The thread panel is smoked glass, not white: night #070A10 at 72% opacity, backdrop blur 24px, one 1px inner highlight on the top edge only in star white at 14%, no other border, no glow, no noise, no refraction, radius 16px, shadow 0 32px 80px rgba(0,0,0,0.45). Stars stay faintly visible through it; if blur kills them, 64%. Remove the white variant.
- Panel text: star white messages, sender names star white at 55%, cursor star white. State rules unchanged.
- Headline breaks in exactly three lines from 1024px up: "The server assistant / that asks before / it answers." Never a single word on a line. Below 1024, two or four lines are acceptable, never five.
- Body line under the headline, final copy: "It answers from what your server already knows, and asks a moderator when it doesn't."
- The beacon photo, when it arrives: height matches the panel's, sitting on the same baseline as the panel's bottom edge. Keep its own shadow; add a soft contact shadow so it stands on the same invisible floor as the panel. Light-state crossfade is masked to the slit only; the body never flickers.
- Until the photo exists the silhouette stays, using the same scale and baseline rules so nothing moves at swap.
- Sky loads behind a solid night fill. No white flash, no flash of unstyled text: fonts preloaded, font-display optional. Before Three.js is ready the hero shows night fill and headline; stars fade in over 600ms; the thread does not start until the sky is up.

#### Dawn, decided
- Hero content (headline, beacon, panel) fades out with the sky over the first third of the dawn band. Nothing from the night is ever visible on paper. Paper content starts after the band ends, never overlapping.
- Scroll-linked with zero latency; no smoothing library, no lerp. Uses the same noise as the nebula, dissolving to flat paper, so the sky thins rather than just changing colour.
- Nav: transparent with star white text over the sky; at 60% through the band it becomes the ink pill with star white text; 40px tall, radius 20, 12px backdrop blur, top center, max 560px wide. Items: wordmark left, "How it works", "Pricing", and "Set up your bot" as the only filled item, right. Below 768px the pill holds the wordmark and "Set up your bot" only.
- No scroll indicator, no arrow, no progress bar.

#### Paper sections, decided
- Section headings: display type 40 to 48px, weight 500, ink, left aligned, max width 20 characters so they break in two lines. Under each, a one-sentence lede in body size, ink soft, max 60 characters per line. No eyebrow, no divider.
- Inbox panel: white, radius 16px, one shadow, hairline rows in #E3E6EA. Row: question ink 17px; sender and channel ink soft 14px; "what it almost knew" as one collapsed line in ink soft with a disclosure expanding to the three chunks; Approve as a text button in ink. The only filled button on the marketing page is "Set up your bot".
- Bot card: white, radius 16px, hairline border #E3E6EA, no shadow. Labels ink soft 14px, values ink 17px. Empty fields show a 1px dashed hairline where the value will go.
- Actions section: four lines of body text each starting with a verb, no icons, no cards. "It doesn't moderate." is its own final line in ink at 20px.
- Audiences: two columns of plain text, two-word heading in ink, three sentences in ink soft. Stack at 768.
- Pricing: three rows in one white panel, hairlines between. Row: name ink 20px left, one sentence ink soft centre, price ink 20px right. Free row link "Start", others "Choose", as text links. Euros, no cents. One line under the panel: "Per server, per month. Cancel anytime."
- Footer: paper, no background change. Left: tagline in ink 20px. Right: four text links in ink soft. Under both, one hairline and a line with the wordmark and the year.

#### Global states and details
- Text selection: ink at 12% on paper, star white at 20% on night. Browser default blue never appears.
- Focus: 2px ring, offset 2px, green on paper, star white on night, keyboard only.
- Links: ink, 1px underline, offset 3px, underline ink at 40%, hover 100%. No coloured links on paper except the green state link in the inbox.
- Buttons: 44px, radius 10px, weight 500. Primary ink on paper, star white on night. Hover 6% shift. Active scales to 0.98 for 80ms. Disabled 40% opacity.
- Default cursor, default scrollbar. No custom cursors, no magnetic buttons.
- Tabular figures. Times "18:00 CET". Dates "Sun 7 Sep".
- No icons on the marketing site. Dashboard: one 16px stroke set at 1.5px, ink soft, only where an action has no room for a word.
- Loading: skeleton blocks #E3E6EA, radius 6px, no shimmer; content replaces in place.
- Toasts: bottom center, ink pill, star white text, 3s, one at a time, stating what happened: "Approved. Added to what Kalvard knows."
- Errors: inline, ink, one sentence saying what happened and what to do. Never red, never an exclamation mark.
- Empty states: one sentence and one action, no illustration. Example: "Nothing waiting on you. Kalvard answered everything this week."
- 404: paper, headline "Not sure about that one." and a link home.
- OG image: the held final hero frame at 1200x630 from the same components. Favicon: avatar mark, ink on transparent for light tabs, star white for dark via media query.

#### Dashboard, decided
- Same tokens, paper only. Left sidebar 240px, ink soft text, current item in ink with a 2px green rule on its left; collapses to a top bar with menu at 1024.
- Page title display 32px, one-sentence lede in ink soft, then content. No breadcrumbs.
- Tables: rows in a white panel with hairlines, never gridlines or zebra stripes. Header row ink soft 14px.
- Forms: labels above, ink soft 14px; fields 44px, radius 8px, hairline border, green focus ring; help text only when needed. Save is a filled ink button bottom right, "Save changes", toast on success. No autosave except onboarding.
- Onboarding chat is paper, not glass: user messages in a white panel right-aligned, Kalvard messages plain text left with the 2px green rule. Quick replies as 36px pills with hairline border. Bot card on the right updates with a 120ms stagger per field.
- Confidence slider: 8px track #E3E6EA, ink thumb, "Cautious" and "Confident" at the ends, one line under it that changes with the value.
- Knowledge score: the word "Thin", "Decent" or "Solid" in ink plus its explaining sentence. No bar, no gauge.

#### Mobile, decided
- Hero at 375: the scene still full-bleed with the beacon kept in frame, headline bottom-left at 40px in three lines, body and buttons below it. Thread screen: panel full width with 16px margins, the thread still plays.
- Dawn band 40vh on mobile. All panels 16px side margins, sections 96px apart. Pricing rows stack name, sentence, price. Nothing hidden on mobile except the two nav links.

#### Process rule
Before showing any screen, check it against this addendum line by line. If a line is impossible in a given case, say which and why, propose one alternative, and continue with it. Never present a screen that violates a line here and wait for me to notice.

## 7. Build order

One line per session. Do not start the next until the current one runs and I've seen it. Before showing UI: screenshot it, critique it against section 6, fix what you find, list what you cut.

1. Scaffold the monorepo, this file, tooling. Both apps boot. Commit.
2. Migrations, `match_chunks`, RLS. Seed one guild with three pasted documents.
3. `packages/core`: `ingest` and `answer`, plus a CLI script to run both against the seed.
4. `packages/ui`: tokens and base components (button, text link, panel, thread message, inbox row, bot card, pricing row, nav in both states). Preview at `/dev/ui` on paper and on night. Also produce three wordmark options and three avatar marks as SVG in `/dev/ui`, built from the tokens. Flat, one colour, no mascot. I pick one of each.
5. The sky. Three nebula variants at different densities and contrast as full-viewport pages. I pick one.
6. The thread over the chosen sky. Three named spring curves for the mod reply. I pick one.
7. Dawn: the scroll-linked transition and the nav change. Nothing else.
8. Auth, `/servers`, guild claim.
9. Knowledge page and test chat.
10. Bot: online and replying to a mention; real answers; the mod ping; ✅ approval loop; settings from DB; actions with allowlist. Runs locally against the test server.

**Deployment is deferred to launch.** The bot runs locally until I say we are going live; nothing is deployed to Railway before then. The production bot is a **separate Discord application** from the development one, with its own client id, secret and token, so the deployed bot and the local one are different bot users and never answer the same message twice. At launch: create the application, put its credentials in Railway's environment, deploy the worker, point the Supabase Discord auth provider at it, and issue the new invite link.
10b. Agentic answer loop, only once line 10 works end to end. Replace the single-shot `answer()` with a tool-using loop (Gemini function calling). Tools: `search_knowledge`, `list_roles`, `check_membership` (the proof is configured per self-serve role in `guild_settings`: a roster document, access to a channel, or holding another role), `assign_role`, `point_to_channel`, `ask_user` (clarify and wait for the reply), `escalate_to_mod` (with a summary of what was tried). At most 5 tool calls per turn; reads are free, writes go through the allowlist; a failed verification is never forced, it escalates. Conversation state per channel and user pair, kept 30 minutes, so a reply continues the same turn instead of starting a new one. It never announces an action it has not taken: the tool runs in the same turn and the reply reports what happened ("C'est fait, tu as le rôle Fast Forward") or why it could not. The reply language is the member's, held for the whole conversation unless `guild_settings.language` forces one, and enforced in code rather than asked for. Asked for something without naming it, it lists what it can give rather than putting one guess to them, and consent is the member naming the thing or saying yes: an annoyed restatement is not agreement. The grounding rule above still holds for every fact it states: an informational turn ends in the same graded reply, with the same four outcomes, so a fact it cannot ground is still hedged or handed to the moderators rather than asserted. Tool results are facts the system supplied, not claims about the server, so they need no chunk. Once the member has plainly asked for one role, the loop stops asking the model what to do: it runs the proof, gives the role and reports it, or escalates when the proof fails. The two things that protect the member run first and are unchanged, their own consent and the owner's proof; what is taken away is the model's discretion to announce instead of act, to ask a third time, or to wake a moderator over a check that passed. Inappropriate content never enters the loop: it is screened first and answered with silence in the channel and one quiet line to the mod channel, exactly as the fourth outcome above. A member cannot approve their own question, even when they hold the mod role: their reply is them talking to Kalvard. Eval, as a scripted conversation that must pass: "salut bg, tu peux me mettre un rôle ?" asks which role; "le rôle FF" looks it up and asks whether FF means fast forward when the name is ambiguous; "oui exactement" checks membership by the configured proof, assigns the role and confirms. The failing variant, where the member is not on the roster, escalates to a moderator with the summary.
11. Onboarding, chat and form modes, bot card, finish-setup screen.
12. Inbox, overview, personality, settings. The inbox is the core: answering there posts to the member in the channel they asked in, closes the question and becomes knowledge, all at once. Personality and settings both save through the same door as everything else, so a persona is checked, a stale edit is refused rather than overwriting somebody, and a forbidden list broad enough to refuse everything warns. Personality carries the dry-run test chat under it: a change of voice is something you hear.
12b. Data sources: the first fetchers behind `guild_settings.data_sources`. Each entry is one source the answer loop may call, `{ id, name, answers, kind, config }`, where `kind` names the fetcher and `name` and `answers` are the owner's own words, shown to the model so it knows what that source covers. The registry, the tool and the first kind are already in place: `open_meteo` answers the weather anywhere, with no key, two allowlisted hosts and a four-second timeout, and it is the shape the rest must fit, free, one hop, and checkable by the member in a second. Fetching only ever happens in the loop; the single-shot path has no tools and says so. The second kind is `rift_legends`, the league's own JSON: `GET {base}/matches?from=&to=` returning `{ matches: [{ id, stage, bestOf, scheduledAt (ISO 8601 UTC), status: scheduled|live|done, teams: [{id,name,tag}], score? }] }` and `GET {base}/teams/{id}/roster` returning `{ team, players: [{ id, handle, role, isCaptain, discordId? }] }`. `discordId` is the field worth having: it is what lets Kalvard tell who somebody is and who to ask on match day, and it is never shown to a member. A source pointed at `fixture:rift-legends` reads `evals/fixtures/rift-legends.json` instead, which is what the evals and the match-day workflow run against, so neither needs the league to be up. Every fetch is https only, no credentials in the address, no redirect off the host, no private or loopback address, a four-second deadline and a size cap; a source that breaks one of those does not fetch and the honest line stands. The owner adds, tests and removes a source on the settings page, and a source is tested against the real fetcher before it is saved: a broken source is worse than none. Adding a source is configuration: it must make previously unanswerable questions answerable with no change to any prompt and none to the loop.
12b (continued). **Command mode.** An owner or a moderator says what they want in plain language, in the dashboard on a Commands page or in Discord by mentioning Kalvard. It resolves the request into a plan of allowlisted actions with the real names filled in, asks one question when something it needs is missing, shows the plan as plain sentences with exact channels, categories, roles and permissions, and waits. The dashboard has Confirm and Cancel; Discord has the same two as message buttons, and only the person who asked may answer their own plan. Confirm carries it out and reports what happened with links; Cancel changes nothing and asks what to do differently. A plan touching more than three things is numbered item by item.

**Who can see a new channel is decided, not defaulted.** Naming roles is how somebody says "these people and not everyone", so a request that creates a channel and names roles for it makes that channel private: `@everyone` cannot see it, the named roles can, and Kalvard keeps its own way in. A request that names no roles is an announcement and stays as open as the category it sits in. Saying "public" or "privé" outright beats both guesses. The plan says which it is in the sentence, and the roles travel with the creation itself, so the channel is never public for the moment between being made and being locked. `set_private` does the same to a channel that already exists.

The rules are code, not prompt: only the actions in `guild_settings.allowed_actions` (`create_channel`, `allow_roles`, `set_private`, `archive_channel`, `post_message`, `pin_message`, `assign_role`), only the owner and holders of the mod role, and never a deletion. A request to delete becomes an archive, which locks the channel and keeps it. Every command is written to `commands` with who asked, the request, the plan, and what actually ran. The web can plan but cannot act: it records the confirmation and the bot, which is the one process holding a Discord connection, carries it out.

Eval (`pnpm --filter @kalvard/core eval:command`): "crée un channel #finale-wcl et mets les rôles Joueur et Caster dedans" plans exactly two steps with those names; the same request with no category asks which one and lists the categories that exist; a category that does not exist asks and says why; a member is refused; an action switched off is refused by name; deleting comes back as archiving; and confirming runs the steps in order, putting the roles on the channel it just made.

12c. Workflows: a per-guild named routine stored as data. New table `workflows` (guild_id, name, trigger jsonb, steps jsonb, checks jsonb, enabled, auto_run bool default false, created_by, last_run). `trigger` is a schedule, a member or moderator request, or a Discord event; `steps` are ordered tool calls with their parameters and naming templates; `checks` are the verifications that must pass and what happens when they do not.

   Three ways one comes into being: the owner describes it in natural language, in the dashboard or by DM, and the model compiles it into steps the owner reviews and approves; the bot notices a repeated sequence of owner actions in `bot_events` and offers to turn it into a workflow; or the server adopts one of the shipped templates (tournament week, member onboarding, weekly announcement, event day) and edits it.

   Running one reuses the agent loop and the same allowlist. It is idempotent: an object that already exists is updated, never duplicated. Anything unmapped stops the run and asks rather than guessing, and every run writes a summary the dashboard shows.

   A workflow is also triggerable in conversation: a moderator or the owner asks in their own words ("prépare les matchs de cette semaine et fais-moi un rapport"), the agent matches it to a workflow, resolves the missing parameters from context and says what it inferred, and asks rather than guessing when one cannot be resolved. It then previews the plan, the counts of what will be created or changed plus anything unmapped, and waits for confirmation whenever the plan touches more than three objects or the workflow is not marked `auto_run`. Afterwards it reports in the channel and in the dashboard: what was done, what was skipped, what needs a human. Only the owner and holders of the configured mod role may trigger one; a member gets a polite refusal.

   **A workflow is a flow, not a list of actions.** Five kinds of step, and steps may read variables set by earlier ones and loop until a condition holds (a best-of-three runs its game step until one side has two wins).
   * `do`: one allowlisted tool call, the same allowlist the answer loop uses.
   * `wait_for`: an event, and what to do when it does not come. A message, an attachment, a reaction or a button press, filtered by channel and by who may satisfy it (a role, a named member, either captain), with a timeout and a timeout action of its own.
   * `ask`: a question put to particular members or roles as Discord buttons or a select menu, with the answer stored as a variable. Free text is a fallback, never the default: a button is unambiguous and a typed answer is not.
   * `if`: a branch on a variable or on a check that has run.
   * `pick`: a random choice, a coin flip, or one item drawn from a list, announced in the channel with what it chose so nobody has to trust it silently.

   **Creating one is a conversation, for someone who knows nothing about any of this.** The owner describes the routine in plain language. The model works out what is missing rather than asking them to specify a flow: who may satisfy each wait, what happens when it times out, who gets asked, what is decided at random. It asks about those one at a time, then reads the whole flow back in plain language for approval. Editing is the same: "ajoute : cinq minutes après le screenshot, demande quel côté pour la game 2" changes the stored flow, and the bot reads back only the part that changed. The structured form is never shown by default; a "show details" toggle reveals it for anyone who wants it.

   **The eval that must pass, as a scripted flow:** a best-of-three match. Both captains get Ready buttons and the flow waits for both, nudging at a timeout; a coin flip picks the side and announces it; after each game it waits for a screenshot, sending a reminder at 30 minutes and pinging the moderators at 45; between games it asks the losing captain which side they want, as buttons; when one side reaches two wins it posts the result and archives. Every wait names who may satisfy it, and every timeout has an action.

   **The bot contract gains interactions.** Kalvard registers the buttons and select menus a running workflow needs, handles `InteractionCreate`, checks that the person who clicked is one the step allows, answers the interaction within Discord's three seconds and does the work after, and records the click as the variable. A click by someone the step does not allow is answered privately and changes nothing. Interactions are claimed by id like every other event, so a double delivery cannot count twice.

   **What is built so far** (the rest of this line remains): the engine, the five step kinds plus `for_each`, the four extended actions (`post_message`, `ask_buttons`, `add_reaction`, `pin_message`) added to the allowlist, the Discord side of buttons including the interaction handler, the `workflows` and `workflow_runs` tables, and the shipped **Match day** template running against the league fixture. Its eval is `pnpm --filter @kalvard/core eval:workflow`: on the fixture's Thursday it announces both matches with the time in the guild's zone, asks both captains by Discord id with buttons, flips a coin and says what it landed on, and registers the screenshot wait with a nudge at 30 minutes and the moderators at 45. On the Sunday after, which has no matches, it does nothing at all. With `post_message` switched off it stops and names the action it lacked; with the channel gone it stops and names the channel. Still to come: the conversational creation and editing, the detection of repeated owner actions, the remaining templates, the dashboard screens, and the scheduler that starts a live run.

   Workflows are one part of what "trained on your playbook" means in the marketing copy.
13. Marketing: inbox rows, bot card, actions, audiences, pricing, footer.
14. Mobile pass at 375px, then a final pass removing one thing from every section.
15. Billing (Stripe): not before I say so.

## 8. Working rules

* Read this file first every session, then only the files needed for the current line.
* **Code for how people actually write, never for the happy path.** Members type "ttk" for Train to kill, "saphire" for Sapphire, "donne moi le role" with no accent and no capital. A feature that only works when somebody spells a name the way the database stores it is not finished, it is a demo. The same holds for what a model returns: it writes a fresh sentence every time, in whichever language, and it will put two hundred words of its own reasoning in a field meant for a name. Check the invariant in code rather than matching the words, and write the eval cases from real inputs — the server's own roles and channels — before the fix, not from examples invented alongside it.
* Every incident or defect becomes an eval case before it is fixed. The case is written first, it fails, and only then is the code changed.
* An eval expectation is never widened twice for the same case. The first widening is allowed when both outcomes are genuinely right for the member; a case that flakes again is fixed in code, not in the expectation, and the eval file records why any widening happened.
* Small commits, one per working feature, imperative messages.
* No unlisted features. If something seems missing, say so in one line and continue.
* Every screen works at 375px.
* When I paste a screenshot with a note, fix that specific thing. Don't redesign around it.
* Never put the service role key in client code. Never log tokens.
* Where I want your taste: spring curves, star density, display type width, how the dawn noise dissolves, the inbox row transition. Offer three named variants. Where I don't: structure, palette, copy, whether anything needs a card.
* Self-check before reporting. After each line: run typecheck, lint, format, build, and every test or verification that applies to what you built (queries, RLS, CLI runs, screenshots at 1120 and 375). Any change to the answer prompt, the tool loop or either schema runs both evals against the seed guild and passes every case before it is reported: `pnpm --filter @kalvard/core eval`, the 20 single messages in `packages/core/evals/cases.json` (message, expected kind, expected tier, and whether the mod mention belongs; a case passes when kind and tier match, the draft or `found` is substantive, and the mention is present exactly when it should be), and `pnpm --filter @kalvard/core eval:chat`, the scripted conversations in `packages/core/evals/conversations.json` (each turn names the tool calls and the outcome expected of it). `pnpm --filter @kalvard/core eval:units` runs the checks that need no model, no network and no database; `eval:db` those that need the database but not the model (optimistic locking, blocked personal data, cross-guild isolation, forget-me); `eval:workflow` runs the match-day workflow against the league fixture and `eval:command` the command planner, neither of which needs Discord. Both run on every change, and the persona and forbidden-topic checks run inside `eval`. Cases that need knowledge the seed must not have, two documents that disagree or a fact that exists in one guild only, name the hardening guild (`pnpm --filter @kalvard/core seed:hardening`) in their `guild` field. Diagnose and fix any failure yourself, up to three attempts, before involving me. Only stop and ask when a decision is genuinely mine: destructive operations, spending money, credentials, or a choice the spec leaves open that changes the product. Otherwise pick the simplest option, note it in one line, and continue. Never wait for a yes on things that aren't destructive.

Repo: https://github.com/wclproleague-star/chatbottest
