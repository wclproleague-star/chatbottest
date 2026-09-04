# Sentry

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
sentry/
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
* `guild_settings`: guild_id pk, bot_name, persona_prompt, language, tone_sample, forbidden_topics text[], fallback_mode (`ping_role` | `quiet_queue`), mod_role_id, allowed_channel_ids text[], indexed_channel_ids text[], intro_channel_id, intro_message, max_reply_chars int default 900, confidence_threshold float default 0.55, allowed_actions text[] default '{}', self_serve_role_ids text[] default '{}', updated_at
* `guild_discord_meta`: guild_id pk, channels jsonb, roles jsonb, synced_at. Written by the bot.
* `documents`: id, guild_id, title, source_type (`upload` | `paste` | `qa` | `mod_answer` | `channel`), storage_path, raw_text, status (`processing` | `ready` | `error`), error_message, chunk_count, created_by, created_at
* `chunks`: id, guild_id, document_id, content, embedding vector(768), token_count, created_at. HNSW cosine index on embedding, btree on guild_id.
* `questions`: id, guild_id, asker_discord_id, asker_name, channel_id, message_id, thread_id, question, bot_draft, top_chunk_ids uuid[], status (`pending` | `answered` | `dismissed`), answer, answered_by, answered_via (`discord` | `dashboard`), created_at, answered_at
* `bot_events`: id, guild_id, type (`answered` | `low_confidence` | `mod_pinged` | `approved` | `action` | `install` | `uninstall`), payload jsonb, created_at
* `onboarding_sessions`: id, guild_id, user_id, mode (`chat` | `form`), messages jsonb, draft_config jsonb, step int, completed bool, created_at, updated_at

RPC `match_chunks(guild_id, query_embedding vector(768), match_count int, min_similarity float)` returning id, content, document_id, similarity.

## 3. Pipeline (`packages/core`)

`ingest({ guildId, documentId })`: load raw text (or download from Storage and extract: txt, md, pdf), chunk at ~400 tokens with 60 overlap keeping headings attached to their paragraphs, embed at 768 dims, insert chunks, mark document `ready` with count. On failure mark `error` with a message.

`answer({ guildId, question, askerName?, channelId?, history? })`

1. Embed the question, call `match_chunks` with count 6 and the guild's threshold.
2. Zero matches: return `{ answered: false, reason: 'no_knowledge', topChunkIds: [] }` without calling the chat model.
3. Otherwise call the chat model with a system prompt built from `guild_settings` (bot_name, persona_prompt, language, forbidden_topics, max_reply_chars, allowed_actions) plus the chunks. JSON output: `{ answer, confidence, usedChunkIds, refused, refusalReason?, action? }`. The prompt states: answer only from the provided knowledge; if it doesn't cover the question, say so and set confidence low; never invent dates, prices, names, or rules; questions touching forbidden topics set `refused`; propose an `action` only from `allowed_actions`.
4. Below threshold or refused: return `answered: false` with the draft and `topChunkIds` so a mod can see what the bot almost knew.
5. Always write a `bot_events` row.

Actions the model may propose, each with typed params: `point_to_channel { channelId }`, `assign_role { roleId }` (only from `self_serve_role_ids`), `open_thread { channelId, title }`, `escalate {}`. The model proposes; it never executes.

`onboard({ sessionId })`: loads the session, asks one short question at a time for the empty config fields, offers concrete options when useful (three tone samples generated from the server purpose, the default forbidden topics: bans and appeals, payments and refunds, personal disputes, staff-only info), runs a gap analysis when the user pastes knowledge ("your rules cover X and Y but nothing on Z, want to add that?"), never asks about a filled field. Returns `{ message, updatedConfig, quickReplies, done }`.

`suggestQuestions({ guildId })`: reads 20 random chunks, returns 5 likely member questions plus 1 the knowledge can't answer.

## 4. Bot (`apps/bot`)

* On `guildCreate`: set `guilds.bot_installed = true`, write `guild_discord_meta`, post `intro_message` in `intro_channel_id` if set, set the bot's nickname to `bot_name`.
* On mention in an allowed channel: call `answer`. If answered, reply. If an `action` came back, validate it against `allowed_actions` and `self_serve_role_ids`, execute it, log a `bot_events` row of type `action` with the reason. If not answered: open a thread on the message, reply "Not sure about this one" and ping `mod_role_id` when `fallback_mode = ping_role`, insert a `questions` row with the thread id and draft.
* In a bot-created thread, a message from a member holding `mod_role_id`: react ✅ and ❓. On ✅ from a mod: store the answer, create a `mod_answer` document, call `ingest`, reply to the original asker in the thread, archive the thread.
* Watch `bot_events` of type `approved` with `answered_via = 'dashboard'` (poll every 15s or Supabase realtime) and post the answer into the original thread.
* Dedup: if a pending question in the same guild has cosine similarity above 0.92, reply with a link to that thread instead of pinging again.
* Rate limit mod pings to 5 per guild per hour; beyond that, queue silently and mark `quiet_queue` in the event payload.
* No kicks, bans, timeouts, or deletes. Ever.

## 5. Web app

Marketing: `/`, `/pricing`, `/how-it-works`. App: `/servers`, `/g/[guildId]/onboarding`, `/g/[guildId]/overview`, `/g/[guildId]/knowledge`, `/g/[guildId]/personality`, `/g/[guildId]/inbox`, `/g/[guildId]/settings`, `/g/[guildId]/test`. Auth via Supabase Discord provider with scopes `identify email guilds`.

Onboarding: first screen offers "Talk it through" or "Fill it in". Both write the same `guild_settings` and optional `documents`, progress persisted in `onboarding_sessions`. Layout: left is the chat or the form; right is a sticky bot card that fills in live (name, tone, language, knowledge score, forbidden topics, who it wakes). Both end on the test chat with generated questions, then "Bring it to Discord" opens the invite URL with `guild_id` preselected. Poll `guilds.bot_installed`; when true show the finish-setup screen with real channel and role pickers from `guild_discord_meta`, save, set `setup_completed`, route to overview. Settings has a "Check in with your bot" button that reopens chat mode with the current config loaded.

Knowledge: upload, paste, Q&A tabs; documents list with status; knowledge score (under 10 chunks "Thin", 10 to 50 "Decent", 50+ "Solid", one line on what that means).

Test chat: calls `answer`; when not answered, a distinct card: "In Discord, this is where I'd ask a mod", with the draft and reason. "Generate test questions" button.

Inbox: pending first (question, asker, channel, draft, what it almost knew, reply box). Submitting: mark answered via dashboard, create `mod_answer` document, `ingest`, write an `approved` event. Dismiss. Answered tab.

Overview: this week's counts (received, answered, sent to mods, awaiting you), top 5 unanswered topics, knowledge score, one nudge card when pending questions are older than 24h or no activity in 14 days.

Personality: persona editor, regenerable tone samples, bot name, language, forbidden topics, max reply length, confidence threshold as a slider from Cautious to Confident, allowed actions and self-serve roles.

Settings: everything else, plus a danger zone (remove bot, delete all data).

## 6. Design

**The concept: night watch**

A sentry is the one awake while everyone else sleeps. The site tells that in one scroll: it opens at night, in a galaxy, with a thread being answered. As you scroll, night turns to dawn, the page becomes paper, and the human side (inbox, mods, setup) appears in daylight. One page, one transition, one idea. Tone: calm, exact, alive. Premium means nothing is loud and everything is finished.

**The five moments** (the only places the page may be spectacular)

1. **The sky.** Three.js starfield, ~15,000 points with real depth, slow drift, cursor parallax on desktop and gyroscope on mobile, max 12px travel. Behind it a nebula as a fragment shader of layered noise, very low contrast, barely moving. Near-monochrome: ink blue-black and warm white. Exactly two tinted stars in the whole sky, one green and one amber, far apart. No purple, no blue glow, no lens flare, no shooting stars.
2. **The thread.** A conversation panel floating over the sky, rendered in the site's own type, not a Discord screenshot. Plays once on load, about nine seconds, then holds:
   * Member: "when's the finals bracket posted?"
   * Sentry, typing at reading speed: "Sunday 18:00 CET, in #announcements. Check-in closes an hour before."
   * Member: "and if my duo can't make check-in?"
   * Sentry, after a beat: "Not sure about that one. Asking @Mods." (amber state)
   * Mod reply lands with a 240ms spring and a small settle: "One sub allowed if declared before check-in."
   * Sentry: "Got it. Next time I'll know." (amber turns green)

   Below it, left aligned: **The server assistant that asks before it answers.** One line of body. One primary button, "Set up your bot". One text link, "See how it learns". Nothing else in the hero.

   A photographed hero object (the beacon, files arriving in `assets/beacon/`) sits centre over the sky with a real drop shadow; headline left, thread right on desktop, stacked on mobile. Its light follows the thread: amber during "Asking @Mods", green on "Got it", via a masked crossfade of three light-state images, 240ms. A short rotation video plays once on load, then holds on the still. Until the files exist, use a placeholder silhouette.
3. **Dawn.** As the hero leaves the viewport the sky fades, not cuts: stars thin, ink lightens through a short dusk band into paper over about 60vh, scroll-linked. The nav follows: transparent over the sky, then a small ink pill on paper. The most important transition on the site. One full session.
4. **The inbox row.** Three real rows: question, bot draft, "what it almost knew", Approve. Two green, one amber. Hover or tap Approve on the amber row: 180ms crossfade to green and the bot's follow-up line appears beneath. The feature, demonstrated, with no icons and no explanatory copy.
5. **The bot card.** Empty fields: name, tone, language, what it knows, what it won't touch, who it wakes. A "Try it" button. On click, fields fill one by one with a 120ms stagger. User-triggered only.

If something moves and it isn't in one of these five, delete it.

**Palette**

Night `#070A10`, dusk `#1A2030` (transition band only), paper `#EDEFF1` (cool, not cream), panel `#FFFFFF` (thread and inbox rows only), ink `#111418`, ink soft `#5B636E`, star white `#F2EEE6`, answered green `#23A55A`, waiting amber `#D9A21B`. Green and amber appear only as states. No gradients except the dawn band. No third colour.

**Type**

One family for everything, including the thread: Instrument Sans, using the width axis deliberately. Display 64 to 80px desktop, 40px mobile, weight 500, tracking -0.025em, slightly condensed. Body 17px, weight 400, line-height 1.55, max 68 characters. Thread messages 15px, line-height 1.45, sender name in ink soft above each message, a 2px left rule in the state colour on Sentry's messages only. UI 14 to 15px. Never a second family, a serif, a monospace, all caps, or a single coloured or italic word in a headline.

**Layout**

Single column, left aligned, max 1120px, 24px mobile gutters. Sections separated by space and scale, never by cards, dividers, or background bands. 160px between sections desktop, 96px mobile.

Page order: sky and thread (full viewport) → dawn → "How it learns" (inbox rows) → "Set up by talking. Or not." (bot card) → "It can point, hand off, and assign the roles you allow. It doesn't moderate." (four short lines, one per action) → "Built for communities. Useful for companies with one." (two columns of plain text) → "Pricing" (three rows that read like a menu: name, one sentence, price; no feature grids) → footer with the tagline.

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
10. Bot: online and replying to a mention; real answers; thread and mod ping; ✅ approval loop; settings from DB; actions with allowlist; Railway deploy.
11. Onboarding, chat and form modes, bot card, finish-setup screen.
12. Inbox, overview, personality, settings.
13. Marketing: inbox rows, bot card, actions, audiences, pricing, footer.
14. Mobile pass at 375px, then a final pass removing one thing from every section.
15. Billing (Stripe): not before I say so.

## 8. Working rules

* Read this file first every session, then only the files needed for the current line.
* Small commits, one per working feature, imperative messages.
* No unlisted features. If something seems missing, say so in one line and continue.
* Every screen works at 375px.
* When I paste a screenshot with a note, fix that specific thing. Don't redesign around it.
* Never put the service role key in client code. Never log tokens.
* Where I want your taste: spring curves, star density, display type width, how the dawn noise dissolves, the inbox row transition. Offer three named variants. Where I don't: structure, palette, copy, whether anything needs a card.
* Self-check before reporting. After each line: run typecheck, lint, format, build, and every test or verification that applies to what you built (queries, RLS, CLI runs, screenshots at 1120 and 375). Diagnose and fix any failure yourself, up to three attempts, before involving me. Only stop and ask when a decision is genuinely mine: destructive operations, spending money, credentials, or a choice the spec leaves open that changes the product. Otherwise pick the simplest option, note it in one line, and continue. Never wait for a yes on things that aren't destructive.

Repo: https://github.com/wclproleague-star/chatbottest
