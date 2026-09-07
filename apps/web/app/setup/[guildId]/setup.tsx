'use client';

// Setting a bot up, on the headland, start to finish.
//
// One scene the whole way: the cliff, the coded sky, the beacon standing
// right of centre with its shadow on the ground, and it never moves. The slit
// is the progress. Dark at the door. One fifth in amber per thing decided —
// name, voice, language, knowledge, scope — from the bottom up. Full amber
// at the test. Green when the bot is live. Nothing else on the page says how
// far along you are: the object does.
//
// Each step lives on smoked glass on the left half of the scene: the
// conversation, the form, the test chat, the finish. What has been decided
// stands on a second, smaller glass to the right of the beacon, as a card of
// facts — only the fields that exist, never a greyed-out one. On a phone the
// glass is the bottom of the screen and the beacon is behind it.

import { Field, Input, Textarea, cx } from '@kalvard/ui';
import type { DraftConfig } from '@kalvard/core';
import type { DragEvent, ReactNode } from 'react';
import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { SupportChoice } from '@/components/dashboard/support-choice';
import {
  GLASS,
  GLASS_LIGHT,
  Glass,
  LiveLine,
  Reveal,
  SCENE_BUTTON,
  SCENE_LINK,
  SetupScene,
  TO_GREEN_MS,
  useWideScreen,
} from './night-scene';
import { useReady } from '@/components/hero/ready';
import { TYPE_MS } from '@/components/hero/script';
import meta from '../../../../../assets/beacon/meta.json';
import { coverRect } from '@/components/hero/scene';
import { PHOTO } from '@/components/sky/beacon';
import {
  addKnowledgeFile,
  addKnowledgePaste,
} from '@/app/g/[guildId]/onboarding/knowledge-actions';
import { TestChat } from '@/app/g/[guildId]/test/test-chat';
import {
  applyDraft,
  botArrived,
  finishSetup,
  saveDraft,
  say,
  startSession,
} from '@/app/g/[guildId]/onboarding/actions';
import type { ChatState } from '@/app/g/[guildId]/onboarding/actions';

type Step = 'entry' | 'chat' | 'form' | 'try' | 'bring' | 'finish' | 'live';
type Named = { id: string; name: string };

/** The five things setup decides, in the order it asks for them: one fifth of the slit each. */
const AREAS: { key: keyof DraftConfig; label: string }[] = [
  { key: 'botName', label: 'Name' },
  { key: 'personaPrompt', label: 'Voice' },
  { key: 'language', label: 'Language' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'scope', label: 'Scope' },
];

export function Setup({
  guildId,
  guildName,
  installed,
  completed,
  inviteUrl,
  channels,
  roles,
  categories = [],
  preview = false,
  startAt,
  previewProgress,
}: {
  guildId: string;
  guildName: string;
  installed: boolean;
  completed: boolean;
  inviteUrl: string;
  channels: Named[];
  roles: Named[];
  /** The categories of the server, for the ticket questions. */
  categories?: Named[];
  /** The design preview: no session, a stub conversation. */
  preview?: boolean;
  startAt?: Step;
  /** The preview's slit, in fifths, to look at one state on its own. */
  previewProgress?: number;
}) {
  const [step, setStep] = useState<Step>(startAt ?? (installed && !completed ? 'finish' : 'entry'));
  const [sessionId, setSessionId] = useState('');
  const [config, setConfig] = useState<DraftConfig>(
    preview && startAt && startAt !== 'entry' ? PREVIEW_CONFIG : {},
  );
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [green, setGreen] = useState(false);
  const turnGreen = useCallback(() => setGreen(true), []);
  // Nothing is shown until the photograph, the fonts and the scene are all
  // ready; until then the beacon breathes and the screen is otherwise empty.
  const { ready, onSceneReady } = useReady();
  // While something is on its way, the sky gives the main thread back.
  const [busy, setBusy] = useState(false);
  // Files dropped before the knowledge step is reached are kept, not lost.
  const [dropping, setDropping] = useState(false);
  const [waitingFiles, setWaitingFiles] = useState<File[]>([]);
  const takeFiles = useRef<((files: File[]) => void) | null>(null);

  const done = AREAS.filter((area) => filled(config, area.key)).length;

  // The light is the state of the whole thing.
  const light = !ready
    ? 'loading'
    : green
      ? 'green'
      : step === 'live'
        ? 'going'
        : busy
          ? 'working'
          : (step === 'chat' || step === 'form') && done === 0
            ? 'off'
            : step === 'entry'
              ? 'off'
              : 'amber';
  const progress = !ready
    ? 1
    : (previewProgress ??
      (step === 'entry' ? 0 : step === 'chat' || step === 'form' ? done / AREAS.length : 1));
  /** Growing a fifth takes 400ms; the turn to green keeps its own pace. */
  const changeMs = green ? TO_GREEN_MS : 400;

  async function begin(mode: 'chat' | 'form') {
    if (preview) {
      setSessionId('preview');
      setStep(mode);
      return;
    }
    const started = await startSession(guildId, mode);
    if ('error' in started) {
      setError(started.error);
      return;
    }
    setSessionId(started.sessionId);
    setStep(mode);
  }

  async function finishDraft(draft: DraftConfig) {
    if (preview) {
      setStep(installed ? 'finish' : 'bring');
      return;
    }
    const outcome = await applyDraft(guildId, sessionId, draft);
    if ('error' in outcome) {
      setError(outcome.error);
      return;
    }
    setWarning(outcome.warning ?? null);
    // The test chat comes last, right before it is pushed live: by then it is
    // configured, it is in the server, and what you are trying is the real thing.
    setStep(installed ? 'finish' : 'bring');
  }

  /** A file dropped anywhere on the panel, at any step. */
  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropping(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    if (step === 'chat' && takeFiles.current) takeFiles.current(files);
    else setWaitingFiles((all) => [...all, ...files]);
  }

  const decided = AREAS.filter((area) => filled(config, area.key));
  const onPanel = step !== 'entry' && step !== 'live';
  const anchors = useSceneAnchors();
  const wideScreen = useWideScreen();
  const panelWide = step === 'try' || step === 'finish';
  const panelLeft = wideScreen ? panelLeftFrom(anchors, panelWide ? 680 : 620) : null;

  return (
    <main data-theme="dark" data-surface="night" className="bg-night text-star">
      <SetupScene
        light={light}
        progress={progress}
        changeMs={changeMs}
        onSceneReady={onSceneReady}
        fps={busy ? 30 : 0}
      >
        <Reveal ready={ready}>
          {/* The door: one line, one button, in the free space above the headland. */}
          {step === 'entry' && (
            <Centred>
              <p className="text-star/85 text-center text-[26px] leading-snug">
                Kalvard isn&apos;t set up yet.
              </p>
              <div className="mt-8 flex justify-center">
                <button className={SCENE_BUTTON} onClick={() => void begin('chat')}>
                  Set it up
                </button>
              </div>
              {error && <p className="text-ui text-star/80 mt-6 text-center">{error}</p>}
            </Centred>
          )}

          {/* One panel for the whole flow: what is in it changes, it does not. */}
          {onPanel && (
            <Glass
              fadeKey={step}
              wide={panelWide}
              left={panelLeft}
              dropping={dropping}
              onDragOver={(event) => {
                event.preventDefault();
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={onDrop}
            >
              {step === 'chat' && (
                <Chat
                  guildId={guildId}
                  sessionId={sessionId}
                  preview={preview}
                  config={config}
                  onConfig={setConfig}
                  onBusy={setBusy}
                  waiting={waitingFiles}
                  onTook={() => setWaitingFiles([])}
                  bindDrop={(fn) => {
                    takeFiles.current = fn;
                  }}
                  onDone={(draft) => void finishDraft(draft)}
                  aside={
                    done === 0 ? (
                      <button className={SCENE_LINK} onClick={() => setStep('form')}>
                        Rather fill in a form?
                      </button>
                    ) : null
                  }
                />
              )}

              {step === 'form' && (
                <Form
                  guildId={guildId}
                  sessionId={sessionId}
                  config={config}
                  preview={preview}
                  onConfig={setConfig}
                  onDone={(draft) => void finishDraft(draft)}
                />
              )}

              {step === 'try' && (
                <>
                  <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    <h1 className="text-star text-[26px] leading-snug">Try it</h1>
                    <p className="text-body text-star/70 mt-2 max-w-[52ch]">
                      This is your bot, answering from what it knows. Nothing it says here touches
                      your server. Try it, then put it live.
                    </p>
                    {warning && <p className="text-ui text-star/70 mt-3 max-w-[52ch]">{warning}</p>}
                    <div className="mt-8">
                      <TestChat guildId={guildId} botName={config.botName ?? 'Kalvard'} />
                    </div>
                  </div>
                  <div className="mt-6 flex flex-wrap items-center gap-6">
                    <button className={SCENE_BUTTON} onClick={() => setStep('live')}>
                      Put it live
                    </button>
                    <button className={SCENE_LINK} onClick={() => setStep('live')}>
                      Skip this
                    </button>
                  </div>
                </>
              )}

              {step === 'bring' && (
                <BringIt
                  guildId={guildId}
                  inviteUrl={inviteUrl}
                  preview={preview}
                  onArrived={() => setStep('finish')}
                  onSkip={() => setStep('finish')}
                />
              )}

              {step === 'finish' && (
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <h1 className="text-star text-[26px] leading-snug">Where it may answer</h1>
                  <p className="text-body text-star/70 mt-2 max-w-[52ch]">
                    It is in {guildName}. Say where it may answer, who it wakes, and where it
                    reports quietly.
                  </p>
                  <Finish
                    guildId={guildId}
                    channels={channels}
                    roles={roles}
                    categories={categories}
                    preview={preview}
                    onDone={() => setStep('try')}
                  />
                </div>
              )}
            </Glass>
          )}

          {onPanel && decided.length > 0 && (
            <Card config={config} areas={decided} anchors={anchors} />
          )}

          {step === 'live' && (
            <Centred>
              <LiveLine guildName={guildName} onGreen={turnGreen}>
                <a href={`/g/${guildId}/overview`} className={cx(SCENE_BUTTON, 'fade-in')}>
                  Open the dashboard
                </a>
              </LiveLine>
            </Centred>
          )}
        </Reveal>
      </SetupScene>
    </main>
  );
}

/** Text and a button, centred in the sky above the headland. */
function Centred({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-[18vh] mx-auto max-w-[44ch] px-6 md:top-[22vh]">
      {children}
    </div>
  );
}

/**
 * What has been decided, on glass beside the beacon: to the right of it, level
 * with the lit part of the slit, so the object and its description read as one
 * unit. Where the window is too narrow to hold a card there it goes back under
 * the foot rather than off the edge. Only fields that exist: an empty one is
 * not a row in grey, it is not there.
 */
const CARD_W = 280;
const CARD_GAP = 36;
/** How close to the window's edge the card may come. */
const CARD_EDGE = 24;

function Card({
  config,
  areas,
  anchors,
}: {
  config: DraftConfig;
  areas: { key: keyof DraftConfig; label: string }[];
  anchors: Anchors | null;
}) {
  const box = useRef<HTMLElement>(null);
  const [tall, setTall] = useState(0);
  useEffect(() => {
    if (!box.current) return;
    const measure = () => setTall(box.current?.offsetHeight ?? 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [areas.length]);
  if (!anchors) return null;

  const beside = anchors.rightEdge + CARD_GAP;
  const fits = beside + CARD_W + CARD_EDGE <= anchors.width;
  const left = fits ? beside : Math.min(anchors.x - CARD_W / 2, anchors.width - CARD_W - CARD_EDGE);
  // Level with the object: what has been decided begins where the beacon
  // begins, so the two read as one thing standing on the headland.
  const top = fits
    ? Math.max(40, Math.min(anchors.top, anchors.height - tall - 40))
    : Math.min(anchors.foot + 16, anchors.height - tall - 40);

  return (
    <aside
      ref={box}
      className="text-star absolute hidden rounded-2xl p-6 lg:block"
      style={{ ...GLASS, left, top, width: CARD_W }}
      aria-label="Decided so far"
    >
      <dl className="space-y-4">
        {areas.map((area) => (
          <div key={String(area.key)}>
            <dt className="text-ui-sm text-star/55">{area.label}</dt>
            <dd className="text-ui text-star mt-0.5 [overflow-wrap:anywhere]">
              {valueOf(config, area.key)}
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/**
 * Where the beacon actually stands on screen, from the numbers the scene lays
 * it out with: the middle of it, its left edge, and its foot. Both boxes are
 * placed from these, so neither drifts to a corner as the window changes.
 */
type Anchors = {
  x: number;
  leftEdge: number;
  rightEdge: number;
  top: number;
  foot: number;
  width: number;
  height: number;
};

function useSceneAnchors(): Anchors | null {
  const [at, setAt] = useState<Anchors | null>(null);
  useEffect(() => {
    const measure = () => {
      const frame = coverRect(window.innerWidth, window.innerHeight);
      const x = frame.left + meta.focusX * frame.width;
      const width = PHOTO.beaconWidth * frame.width;
      setAt({
        x,
        leftEdge: x - width / 2,
        rightEdge: x + width / 2,
        top: frame.top + PHOTO.beaconTop * frame.height,
        foot: frame.top + PHOTO.beaconBase * frame.height,
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return at;
}

/**
 * The panel's left edge. It stands against the beacon rather than against the
 * window: the middle of the scene is where the eye is, and a panel pushed
 * into the far corner leaves the whole centre empty.
 */
const PANEL_GAP = 56;
const PANEL_EDGE = 40;

function panelLeftFrom(anchors: { leftEdge: number } | null, width: number): number | null {
  if (!anchors) return null;
  return Math.max(PANEL_EDGE, anchors.leftEdge - PANEL_GAP - width);
}

function filled(config: DraftConfig, key: keyof DraftConfig): boolean {
  const value = config[key];
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && String(value).trim());
}

function valueOf(config: DraftConfig, key: keyof DraftConfig): string {
  if (key === 'knowledge') {
    const docs = config.knowledge ?? [];
    return docs.length > 0 ? docs.map((d) => d.title).join(', ') : '';
  }
  if (key === 'scope') {
    if (!config.scope) return '';
    return config.scope === 'open' ? 'Answers general questions too' : 'This server only';
  }
  const value = config[key];
  return Array.isArray(value) ? value.join(', ') : ((value as string) ?? '');
}

const PREVIEW_CONFIG: DraftConfig = {
  botName: 'Kalvard',
  personaPrompt: 'A competitive Wild Rift league. Short and exact, no small talk.',
  language: 'The language each member writes in',
};

/**
 * The walk-through: the five questions setup asks, in order, each with what
 * the answer decides. Nothing here talks to anything — it is the flow, so an
 * owner can see the whole of it before it ever touches their server.
 */
const PREVIEW_SCRIPT: {
  question: string;
  replies?: string[];
  /** What the answer to this question fills in. */
  fill: (said: string) => Partial<DraftConfig>;
}[] = [
  {
    question: 'Let us set up your bot for Wild Champions League. What should it be called?',
    replies: ['Kalvard'],
    fill: (said) => ({ botName: said }),
  },
  {
    question: 'In a sentence or two: what is this server for, and how should it talk in it?',
    replies: ['A competitive Wild Rift league, sixteen teams. Short and exact.'],
    fill: (said) => ({ personaPrompt: said }),
  },
  {
    question: 'What language should it reply in?',
    replies: ['The language each member writes in', 'French'],
    fill: (said) => ({ language: said }),
  },
  {
    question:
      'Paste something it should know: your rules, your schedule, anything members ask about. A file works too.',
    replies: ['Not yet, I will add it later'],
    fill: (said) =>
      /^not yet|^later|^skip/i.test(said)
        ? {}
        : {
            knowledge: [
              { title: said.split('\n')[0]?.slice(0, 60) || 'What the server knows', text: said },
            ],
          },
  },
  {
    question: 'Last one: should it answer questions that are not about this server?',
    replies: ['Yes, general questions too', 'This server only'],
    fill: (said) => ({ scope: /this server/i.test(said) ? 'server_only' : 'open' }),
  },
];

/** The 52px input inside the glass: transparent, a hairline that turns amber on focus, Send inside it. */
function GlassInput({
  value,
  onChange,
  onSubmit,
  onFiles,
  sending,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** The paperclip: the same door as dropping a file on the panel. */
  onFiles?: (files: File[]) => void;
  sending?: boolean;
  placeholder: string;
}) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <form
      className="border-star/25 focus-within:border-amber flex h-[52px] items-center rounded-xl border pl-2 pr-1.5 transition-colors"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {onFiles && (
        <>
          <button
            type="button"
            onClick={() => picker.current?.click()}
            aria-label="Add a file"
            title="Add a file: .txt, .md or .pdf"
            className="text-star/60 hover:text-star hover:bg-star/10 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
              <path
                d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <input
            ref={picker}
            type="file"
            accept=".txt,.md,.markdown,.pdf"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = '';
              if (files.length > 0) onFiles(files);
            }}
          />
        </>
      )}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="text-star placeholder:text-star/40 h-full min-w-0 flex-1 bg-transparent px-2 text-[16px] outline-none"
      />
      <button
        type="submit"
        disabled={sending}
        className="bg-star text-night h-10 shrink-0 rounded-[10px] px-5 text-[15px] font-medium shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] transition-[filter,transform] hover:brightness-[1.06] active:scale-[0.98] disabled:opacity-40"
      >
        Send
      </button>
    </form>
  );
}

/** A paste this long is not an answer to a question; it is the knowledge itself. */
const PASTE_IS_KNOWLEDGE = 200;

/** One file on its way in: named, with a thin amber bar, then read. */
type Upload = { id: number; name: string; state: 'reading' | 'ready' | 'failed'; note?: string };

/**
 * The conversation. Kalvard's question at 26px with the green rule, the
 * owner's answers as smaller bubbles on lighter glass, and at the knowledge
 * step three ways to hand it something to know: the paperclip, a long paste,
 * or a file dropped on the panel.
 *
 * What the owner types appears the instant they press Enter, before anything
 * is sent; the reply types itself out at the hero's rhythm, into space the
 * panel has already made for it.
 */
function Chat({
  guildId,
  sessionId,
  preview,
  config,
  onConfig,
  onDone,
  onBusy,
  waiting,
  onTook,
  bindDrop,
  aside,
}: {
  guildId: string;
  sessionId: string;
  preview?: boolean;
  config: DraftConfig;
  onConfig: (config: DraftConfig) => void;
  onDone: (config: DraftConfig) => void;
  /** True while something is on its way: the scene slows down for it. */
  onBusy?: (busy: boolean) => void;
  /** Files dropped before this step was reached. */
  waiting?: File[];
  onTook?: () => void;
  /** Hands the panel a way to pass files dropped on it. */
  bindDrop?: (fn: (files: File[]) => void) => void;
  aside?: ReactNode;
}) {
  const [state, action, pending] = useActionState<ChatState | null, FormData>(say, null);
  const [turns, setTurns] = useState<{ role: 'user' | 'model'; text: string }[]>(
    preview ? [{ role: 'model', text: PREVIEW_SCRIPT[0]!.question }] : [],
  );
  // Where the walk-through has got to, and whether it has run out of questions.
  const [at, setAt] = useState(0);
  const [walked, setWalked] = useState(false);
  const [draft, setDraft] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  // How much of the last thing Kalvard said has been typed out.
  const [typed, setTyped] = useState<number | null>(null);
  const opened = useRef(false);
  const seen = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (preview || !sessionId || opened.current) return;
    opened.current = true;
    const data = new FormData();
    data.set('guild_id', guildId);
    data.set('session_id', sessionId);
    data.set('said', '');
    action(data);
  }, [preview, sessionId, guildId, action]);

  useEffect(() => {
    if (!state || state.id === seen.current) return;
    seen.current = state.id;
    if (state.config) onConfig(state.config);
    if (state.message) {
      setTurns((all) => [...all, { role: 'model' as const, text: state.message! }]);
      setTyped(0);
    }
  }, [state, onConfig]);

  // The reply arrives whole and is typed out, at the hero's rhythm.
  useEffect(() => {
    const last = turns.at(-1);
    if (typed === null || !last || last.role !== 'model' || typed >= last.text.length) return;
    const timer = window.setTimeout(() => setTyped((n) => (n ?? 0) + 1), TYPE_MS);
    return () => window.clearTimeout(timer);
  }, [typed, turns]);

  useEffect(() => {
    onBusy?.(pending || uploads.some((u) => u.state === 'reading'));
  }, [pending, uploads, onBusy]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, typed, pending, uploads.length]);

  /** Reads one thing the owner handed over, and says what it found. */
  const take = useCallback(
    async (input: { file?: File; text?: string }) => {
      const id = Date.now() + Math.random();
      // The walk-through reads nothing: it shows what reading looks like.
      if (preview) {
        const name = input.file?.name ?? 'what you pasted';
        setUploads((all) => [...all, { id, name, state: 'reading' }]);
        window.setTimeout(() => {
          setUploads((all) => all.map((u) => (u.id === id ? { ...u, state: 'ready' } : u)));
          onConfig({
            ...configRef.current,
            knowledge: [
              ...(configRef.current.knowledge ?? []),
              { title: name, text: '', documentId: 'simulated', pieces: 18 },
            ],
          });
          setTurns((all) => [
            ...all,
            {
              role: 'model' as const,
              text: `Read ${name}, 18 pieces. Nothing in it says when matches are played.`,
            },
          ]);
          setTyped(0);
        }, 1100);
        return;
      }
      const name = input.file?.name ?? 'what you pasted';
      setUploads((all) => [...all, { id, name, state: 'reading' }]);
      const data = new FormData();
      data.set('guild_id', guildId);
      if (input.file) data.set('file', input.file);
      if (input.text) data.set('text', input.text);
      const added = input.file ? await addKnowledgeFile(data) : await addKnowledgePaste(data);
      if (!added.ok) {
        setUploads((all) =>
          all.map((u) => (u.id === id ? { ...u, state: 'failed', note: added.error } : u)),
        );
        return;
      }
      setUploads((all) => all.map((u) => (u.id === id ? { ...u, state: 'ready' } : u)));
      // The fifth lights as soon as the first document is read.
      onConfig({
        ...configRef.current,
        knowledge: [
          ...(configRef.current.knowledge ?? []),
          { title: added.title, text: '', documentId: added.documentId, pieces: added.pieces },
        ],
      });
      const said = [
        `Read ${added.title}, ${added.pieces} piece${added.pieces === 1 ? '' : 's'}.`,
        added.gap,
      ]
        .filter(Boolean)
        .join(' ');
      setTurns((all) => [...all, { role: 'model' as const, text: said }]);
      setTyped(0);
    },
    [guildId, preview, onConfig],
  );

  const takeFiles = useCallback(
    (files: File[]) => {
      for (const file of files) void take({ file });
    },
    [take],
  );

  // The panel hands over what was dropped on it, wherever it was dropped.
  useEffect(() => {
    bindDrop?.(takeFiles);
  }, [bindDrop, takeFiles]);

  // Files dropped before this step was reached were kept; they are read now.
  const tookWaiting = useRef(false);
  useEffect(() => {
    if (tookWaiting.current || !waiting || waiting.length === 0) return;
    tookWaiting.current = true;
    takeFiles(waiting);
    onTook?.();
  }, [waiting, takeFiles, onTook]);

  function send(text: string) {
    const said = text.trim();
    if (!said || pending) return;

    // The walk-through: the answer lands, the fifth lights, the next question
    // comes. No session, no model, nothing written down.
    if (preview) {
      const step = PREVIEW_SCRIPT[at];
      if (!step || walked) return;
      setTurns((all) => [...all, { role: 'user' as const, text: said }]);
      setDraft('');
      onConfig({ ...configRef.current, ...step.fill(said) });
      const next = PREVIEW_SCRIPT[at + 1];
      setAt(at + 1);
      window.setTimeout(() => {
        if (next) {
          setTurns((all) => [...all, { role: 'model' as const, text: next.question }]);
          setTyped(0);
        } else {
          setWalked(true);
          setTurns((all) => [
            ...all,
            { role: 'model' as const, text: 'That is everything I need. Have a go with it.' },
          ]);
          setTyped(0);
        }
      }, 260);
      return;
    }
    // A long paste is knowledge, not an answer to the question on screen.
    if (said.length >= PASTE_IS_KNOWLEDGE) {
      setTurns((all) => [...all, { role: 'user' as const, text: said.slice(0, 140) + '…' }]);
      setDraft('');
      void take({ text: said });
      return;
    }
    // What they typed is on screen before anything is sent.
    setTurns((all) => [...all, { role: 'user' as const, text: said }]);
    setDraft('');
    const data = new FormData();
    data.set('guild_id', guildId);
    data.set('session_id', sessionId);
    data.set('said', said);
    action(data);
  }

  const replies = preview
    ? walked
      ? []
      : (PREVIEW_SCRIPT[at]?.replies ?? [])
    : (state?.quickReplies ?? []);
  const last = turns.length - 1;
  const finished = preview ? walked : Boolean(state?.done);

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        {turns.map((turn, i) =>
          turn.role === 'model' ? (
            <p
              key={i}
              className={cx(
                'border-green border-l-2 pl-4',
                // The last thing Kalvard said is the question you are
                // answering: 26px, star white, the dominant thing on screen.
                // What came before is 16px and quieter.
                i === last && !pending
                  ? 'text-star text-[26px] leading-snug'
                  : 'text-ink-soft text-[16px] leading-normal',
              )}
            >
              {i === last && typed !== null ? turn.text.slice(0, typed) : turn.text}
              {i === last && typed !== null && typed < turn.text.length && (
                <span aria-hidden className="bg-star ml-0.5 inline-block h-[0.9em] w-px" />
              )}
            </p>
          ) : (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-xl px-4 py-2.5" style={GLASS_LIGHT}>
                <p className="text-ink-soft text-[16px] leading-normal">{turn.text}</p>
              </div>
            </div>
          ),
        )}

        {/* While it thinks: the space the reply will take, and a cursor in it. */}
        {pending && (
          <p className="border-green text-star min-h-[2.4em] border-l-2 pl-4 text-[26px] leading-snug">
            <span aria-hidden className="bg-star cursor inline-block h-[0.9em] w-px" />
            <span className="sr-only">Thinking</span>
          </p>
        )}

        {uploads.length > 0 && (
          <ul className="space-y-3">
            {uploads.map((upload) => (
              <li key={upload.id}>
                <div className="text-ui text-star/70 flex items-baseline justify-between gap-4">
                  <span className="truncate">{upload.name}</span>
                  <span className="text-ui-sm text-star/55 shrink-0">
                    {upload.state === 'reading'
                      ? 'Reading'
                      : upload.state === 'ready'
                        ? 'Ready'
                        : 'Could not read it'}
                  </span>
                </div>
                <div className="bg-star/10 mt-1.5 h-[2px] w-full overflow-hidden rounded-full">
                  <div
                    className={cx(
                      'bg-amber h-full transition-[width] duration-500',
                      upload.state === 'reading' && 'reading-bar',
                    )}
                    style={{ width: upload.state === 'reading' ? '40%' : '100%' }}
                  />
                </div>
                {upload.note && (
                  <p className="text-ui-sm text-star/70 mt-1">
                    {upload.note}{' '}
                    <button
                      className={SCENE_LINK}
                      onClick={() => setUploads((all) => all.filter((u) => u.id !== upload.id))}
                    >
                      Try another
                    </button>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {replies.length > 0 && !pending && (
          <div className="flex flex-wrap gap-2">
            {replies.map((reply) => (
              <button
                key={reply}
                onClick={() => send(reply)}
                className="text-ui border-star/25 text-star hover:bg-star/10 h-9 rounded-full border px-4 transition-colors"
              >
                {reply}
              </button>
            ))}
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="mt-5">
        {finished ? (
          <button
            className={SCENE_BUTTON}
            onClick={() => onDone(state?.config ?? configRef.current)}
          >
            Save and try it
          </button>
        ) : (
          <GlassInput
            value={draft}
            onChange={setDraft}
            onSubmit={() => send(draft)}
            onFiles={takeFiles}
            sending={pending}
            placeholder="Your answer, or paste what it should know"
          />
        )}
        {aside && <div className="mt-4">{aside}</div>}
      </div>
    </>
  );
}

/** The same five things, as a form, on the glass. */
function Form({
  guildId,
  sessionId,
  config,
  preview,
  onConfig,
  onDone,
}: {
  guildId: string;
  sessionId: string;
  config: DraftConfig;
  preview?: boolean;
  onConfig: (config: DraftConfig) => void;
  onDone: (config: DraftConfig) => void;
}) {
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<DraftConfig>) => onConfig({ ...config, ...patch });
  const ready = Boolean(config.botName?.trim() && config.personaPrompt?.trim());

  return (
    <form
      className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        if (!preview) await saveDraft(guildId, sessionId, config);
        setSaving(false);
        onDone(config);
      }}
    >
      <Field label="What is it called?">
        <Input
          value={config.botName ?? ''}
          onChange={(e) => set({ botName: e.target.value })}
          placeholder="Kalvard"
        />
      </Field>
      <Field
        label="What is this server for, and how should it talk?"
        help="Tone only. It answers from what your server knows, whatever you write here."
      >
        <Textarea
          rows={3}
          value={config.personaPrompt ?? ''}
          onChange={(e) => set({ personaPrompt: e.target.value })}
        />
      </Field>
      <Field label="What language should it reply in?">
        <Input
          value={config.language ?? ''}
          onChange={(e) => set({ language: e.target.value })}
          placeholder="The language each member writes in"
        />
      </Field>
      <Field label="Paste something it should know" help="You can add more later.">
        <Textarea
          rows={4}
          value={config.knowledge?.[0]?.text ?? ''}
          onChange={(e) =>
            set({
              knowledge: e.target.value.trim()
                ? [
                    {
                      title: e.target.value.split('\n')[0]?.slice(0, 80) || 'What the server knows',
                      text: e.target.value,
                    },
                  ]
                : [],
            })
          }
        />
      </Field>
      <Field label="Should it answer questions that are not about this server?">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['open', 'Yes, general questions too'],
              ['server_only', 'This server only'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => set({ scope: value })}
              aria-pressed={config.scope === value}
              className={cx(
                'text-ui h-9 rounded-full border px-4 transition-colors',
                config.scope === value
                  ? 'border-star bg-star text-night'
                  : 'border-star/25 text-star hover:bg-star/10',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
      <div className="pt-2">
        <button type="submit" className={SCENE_BUTTON} disabled={!ready || saving}>
          {saving ? 'Saving' : 'Save and try it'}
        </button>
      </div>
    </form>
  );
}

/**
 * The channels, without the wall. A server has forty of them and a list of
 * forty tick boxes is not a question anybody answers: this one is filtered as
 * you type, scrolls inside its own box, and says how many are ticked.
 */
function ChannelPicker({ channels }: { channels: Named[] }) {
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const shown = channels.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <div className="space-y-2">
      <input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Find a channel"
        aria-label="Find a channel"
        className="border-star/25 text-star placeholder:text-star/40 focus:border-amber h-11 w-full rounded-lg border bg-transparent px-3 text-[15px] outline-none transition-colors"
      />
      <div className="border-star/15 max-h-[220px] overflow-y-auto rounded-lg border">
        {shown.length === 0 && (
          <p className="text-ui-sm text-star/55 px-3 py-3">Nothing by that name.</p>
        )}
        {shown.map((channel) => (
          <label
            key={channel.id}
            className="text-ui text-star hover:bg-star/5 flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors"
          >
            <input
              type="checkbox"
              name="answer_in"
              value={channel.id}
              checked={picked.includes(channel.id)}
              onChange={(event) =>
                setPicked((all) =>
                  event.target.checked
                    ? [...all, channel.id]
                    : all.filter((id) => id !== channel.id),
                )
              }
            />
            #{channel.name}
          </label>
        ))}
      </div>
      <p className="text-ui-sm text-star/55">
        {picked.length === 0
          ? 'None ticked: it answers wherever it is mentioned.'
          : `${picked.length} channel${picked.length === 1 ? '' : 's'} ticked.`}
      </p>
    </div>
  );
}

function BringIt({
  guildId,
  inviteUrl,
  preview,
  onArrived,
  onSkip,
}: {
  guildId: string;
  inviteUrl: string;
  preview?: boolean;
  onArrived: () => void;
  onSkip?: () => void;
}) {
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!waiting || preview) return;
    let live = true;
    const timer = window.setInterval(async () => {
      if (await botArrived(guildId)) {
        if (live) onArrived();
      }
    }, 4000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [waiting, preview, guildId, onArrived]);

  const url = inviteUrl
    ? `${inviteUrl}${inviteUrl.includes('?') ? '&' : '?'}guild_id=${guildId}`
    : '';

  return (
    <div>
      <h1 className="text-star text-[22px] leading-snug">Bring it to Discord</h1>
      <p className="text-body text-star/70 mt-2">
        Add it to your server, then come back. This page notices when it arrives.
      </p>
      <div className="mt-8">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={() => setWaiting(true)}
            className={SCENE_BUTTON}
          >
            Bring it to Discord
          </a>
        ) : (
          <p className="text-ui text-star">
            No invite link is configured. Set DISCORD_BOT_INVITE_URL and reload.
          </p>
        )}
      </div>
      {waiting && <p className="text-ui text-star/60 mt-4">Waiting for it to appear</p>}
      {onSkip && (
        <div className="mt-6">
          <button className={SCENE_LINK} onClick={onSkip}>
            Skip this
          </button>
        </div>
      )}
    </div>
  );
}

function Finish({
  guildId,
  channels,
  roles,
  categories,
  preview,
  onDone,
}: {
  guildId: string;
  channels: Named[];
  roles: Named[];
  categories: Named[];
  preview?: boolean;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(finishSetup, null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state?.ok, onDone]);

  if (channels.length === 0 && roles.length === 0) {
    return (
      <p className="text-body text-star/70 mt-10 max-w-[60ch]">
        Kalvard has not read your channels and roles yet. Give it a moment and reload.
      </p>
    );
  }

  const select =
    'border-star/25 text-star h-11 w-full rounded-lg border bg-transparent px-3 text-ui focus:border-amber outline-none';

  return (
    <>
      <form action={preview ? () => setSaved(true) : action} className="mt-8 space-y-6">
        <input type="hidden" name="guild_id" value={guildId} />
        <Field
          label="Where may it answer?"
          help="Leave all unticked and it answers wherever it is mentioned."
        >
          <ChannelPicker channels={channels} />
        </Field>
        <Field label="Who does it wake when it is not sure?">
          <select name="mod_role" defaultValue="" className={select}>
            <option value="">Choose a role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Where should it report quietly?"
          help="Harassment, slurs and scams are never answered in public. They go here instead."
        >
          <select name="mod_channel" defaultValue="" className={select}>
            <option value="">Nowhere, just record it</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
        </Field>
        {state?.error && <p className="text-ui text-star">{state.error}</p>}
        {preview && saved && <p className="text-ui text-star/60">Saved, in the walk-through.</p>}
        <button type="submit" className={SCENE_BUTTON} disabled={pending}>
          {pending ? 'Saving' : 'Save changes'}
        </button>
      </form>
      <div className="mt-12">
        <h2 className="text-star text-[22px] leading-snug">Where members get help</h2>
        <p className="text-body text-star/70 mt-2">
          One of three. Kalvard asks what it needs, one thing at a time, shows the plan, and creates
          nothing until you say yes. You can change it later in Settings.
        </p>
        <div className="mt-6">
          <SupportChoice
            guildId={guildId}
            current={null}
            currentChannel={null}
            onDone={preview ? onDone : undefined}
            simulate={
              preview
                ? {
                    channels,
                    categories,
                    roles,
                    allowedActions: [
                      'create_channel',
                      'allow_roles',
                      'set_private',
                      'archive_channel',
                      'post_message',
                    ],
                    modRole: roles[0],
                  }
                : undefined
            }
          />
        </div>
      </div>
    </>
  );
}
