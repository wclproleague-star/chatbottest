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
3. Otherwise call the chat model with a system prompt built from `guild_settings` (bot_name, persona_prompt, language, forbidden_topics, max_reply_chars, allowed_actions) plus the chunks. JSON output, in this order: `{ coverage, answer, confidence, usedChunkIds, refused, refusalReason?, action? }`. `coverage` is `full` | `partial` | `none`, and the model commits to it before it writes the answer (the schema orders it first). The prompt states: answer only from the provided knowledge; decide coverage first (`full`: the knowledge answers the exact question; `partial`: it covers the topic but not the specific case asked, such as an exception or a what-if; `none`: unrelated); related is not answered: on `partial` or `none`, say you are not sure about that specific case and set confidence low, never answer the nearby question instead; never invent dates, prices, names, or rules; questions touching forbidden topics set `refused`; propose an `action` only from `allowed_actions`.
4. In code, cap confidence at 0.4 unless coverage is `full`, so a partial match falls under the default threshold and reaches a mod; an owner who sets the threshold below 0.4 accepts partial answers. Below threshold or refused: return `answered: false` with the draft and `topChunkIds` so a mod can see what the bot almost knew. `coverage` stays internal; the returned shape is unchanged.
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
2. **The scene, then the thread.** The hero is layered over one generated 16:9 still (`assets/beacon/`: a tall matte black beacon alone on a headland above the sea at night, one slit of light, moonless sky, beacon in the right third). Back to front: the still with a 6px defocus and its sky cleaned to near night; the coded sky from moment 1 as a motion layer over the sky region only, nebula contrast 12% here; the wordmark SENTRY in the condensed cut, weight 700 for this single use, tracking -0.01em so the letters nearly touch, star white, sized to span the container; the beacon as a procedural 3D object rendered with Three.js in the same canvas as the sky: one tapered prism, 1:1 in plan, 0.4% chamfers, a recessed slit with beveled inner faces holding the emissive strip; MeshPhysicalMaterial, albedo #0B0D10, roughness 0.78 under a brushed roughness map, metalness 0.05; an environment built from the scene's colours, a cold key from upper left, a faint blue fill from the sea side, the slit as a rect area light in the state colour; a contact shadow and a warm spill on the grass; ACES tone mapping, bloom on the emissive only, film grain matched to the still; camera matched to the still, the base where the photograph's monolith stood, about 20% slimmer than it, 4px of cursor parallax, no rotation. It stands in front of the letters. The still keeps the defocus; its own beacon is removed. Bottom-left, one caption block: the headline at 32px, **The server assistant that asks before it answers.**, and the body at 17px. Bottom-right: the primary button "Set up your bot" and the text link "See how it learns". Pill nav top centre. Nothing else in the hero.

   Second screen, pinned: as the hero scrolls, the scene holds and darkens 20%, and a conversation panel in smoked glass plays once over it, rendered in the site's own type, not a Discord screenshot. About nine seconds, then holds:
   * Member: "when's the finals bracket posted?"
   * Sentry, typing at reading speed: "Sunday 18:00 CET, in #announcements. Check-in closes an hour before."
   * Member: "and if my duo can't make check-in?"
   * Sentry, after a beat: "Not sure about that one. Asking @Mods." (amber state)
   * Mod reply lands with a 240ms spring and a small settle: "One sub allowed if declared before check-in."
   * Sentry: "Got it. Next time I'll know." (amber turns green)

   The beacon's light follows the thread: amber at rest and during "Asking @Mods", green while Sentry answers and on "Got it", a 240ms change of the slit's colour; the body never flickers. Dawn follows after this screen.
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
- Toasts: bottom center, ink pill, star white text, 3s, one at a time, stating what happened: "Approved. Added to what Sentry knows."
- Errors: inline, ink, one sentence saying what happened and what to do. Never red, never an exclamation mark.
- Empty states: one sentence and one action, no illustration. Example: "Nothing waiting on you. Sentry answered everything this week."
- 404: paper, headline "Not sure about that one." and a link home.
- OG image: the held final hero frame at 1200x630 from the same components. Favicon: avatar mark, ink on transparent for light tabs, star white for dark via media query.

#### Dashboard, decided
- Same tokens, paper only. Left sidebar 240px, ink soft text, current item in ink with a 2px green rule on its left; collapses to a top bar with menu at 1024.
- Page title display 32px, one-sentence lede in ink soft, then content. No breadcrumbs.
- Tables: rows in a white panel with hairlines, never gridlines or zebra stripes. Header row ink soft 14px.
- Forms: labels above, ink soft 14px; fields 44px, radius 8px, hairline border, green focus ring; help text only when needed. Save is a filled ink button bottom right, "Save changes", toast on success. No autosave except onboarding.
- Onboarding chat is paper, not glass: user messages in a white panel right-aligned, Sentry messages plain text left with the 2px green rule. Quick replies as 36px pills with hairline border. Bot card on the right updates with a 120ms stagger per field.
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
