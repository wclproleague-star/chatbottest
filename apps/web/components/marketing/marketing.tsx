'use client';

// The marketing page: one scroll, one object.
//
// The beacon never leaves. It opens full-bleed on the headland at night, and
// from the thread onward it stands in a column on the right, vertically
// centred, while the left column scrolls past it. The content changes on the
// left; the object reacts on the right. Its light is the narrator, and it is
// the only thing on the page that is allowed to say something twice.
//
// Which section you are in is the only thing driving it: an observer sets one
// name, and the object animates to whatever that name means. Nothing else on
// the page moves, except the five things in the motion budget.

import { ButtonLink, Display, Nav, PricingList, PricingRow, Surface, TextLink } from '@kalvard/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Wordmark } from '@/components/hero/wordmark';
import { useReady } from '@/components/hero/ready';
import type { Light } from '@/components/sky/beacon';
import { Carousel, FITS, PRICES, RunSummary, SETUP_STILL } from './sections';
import type { Card } from './sections';
import { Stage } from './stage';
import { Thread } from './thread';

/** The sections, in the order they are read, and what the light does in each. */
type SceneName =
  'hero' | 'thread' | 'dawn' | 'does' | 'week' | 'setup' | 'fits' | 'pricing' | 'close';

const RESTING: Record<SceneName, Light> = {
  hero: 'watching',
  thread: 'watching',
  dawn: 'watching',
  does: 'watching',
  week: 'working',
  setup: 'watching',
  fits: 'watching',
  pricing: 'watching',
  close: 'answered',
};

/** The typed line in the hero: five verbs, one at a time. */
const VERBS = ['answers', 'organizes', 'schedules', 'assigns', 'asks'];
const VERB_MS = 2200;

export function Marketing() {
  const [scene, setScene] = useState<SceneName>('hero');
  const [light, setLight] = useState<Light>('watching');
  const [dawn, setDawn] = useState(0);
  const [settled, setSettled] = useState(0);
  const [verb, setVerb] = useState(0);
  const [weekDone, setWeekDone] = useState(false);
  const sections = useRef(new Map<SceneName, HTMLElement>());
  const ready = useReady();

  // One observer, one value: which section is being read. Everything the
  // object does follows from that, so a new section cannot invent its own
  // behaviour without saying which of the eleven states it wants.
  useEffect(() => {
    // A band across the middle of the screen decides, rather than a share of
    // each section: sections are not the same height, and a page where a tall
    // one keeps the light because it covers more of the screen reads as the
    // object lagging behind the reader.
    const seen = new IntersectionObserver(
      (entries) => {
        const showing = entries.find((e) => e.isIntersecting);
        const name = showing?.target.getAttribute('data-scene') as SceneName | null;
        if (name) setScene(name);
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    for (const el of sections.current.values()) seen.observe(el);
    return () => seen.disconnect();
  }, []);

  // Two things are scroll-linked rather than observed: the object leaving the
  // hero, and the dawn. Both have to track the scroll exactly, with no easing
  // in between, or the page feels like it is catching up with the reader.
  useEffect(() => {
    const onScroll = () => {
      const h = window.innerHeight;
      const y = window.scrollY;
      setSettled(Math.min(1, Math.max(0, (y - h * 0.35) / (h * 0.5))));
      const bandStart = h * 1.6;
      const band = h * 0.6;
      const morning = Math.min(1, Math.max(0, (y - bandStart) / band));
      // And the night comes back for the close, on the same value, so the
      // page ends in the place it started rather than in a different one.
      const close = sections.current.get('close');
      const closeTop = close ? close.getBoundingClientRect().top + y : Number.POSITIVE_INFINITY;
      const returning = Math.min(1, Math.max(0, (y - (closeTop - h)) / (h * 0.7)));
      setDawn(morning * (1 - returning));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setVerb((n) => (n + 1) % VERBS.length), VERB_MS);
    return () => window.clearInterval(timer);
  }, []);

  // The light: the section's resting state, unless something inside it is
  // actually happening — the thread playing, a card being looked at, the run
  // summary still writing.
  const [inner, setInner] = useState<Light | null>(null);
  // Which section is showing, readable from a callback that was made once.
  // Without it the carousel goes on driving the light from three sections
  // away, and the page closes on amber when the close is meant to be green.
  const showing = useRef<SceneName>('hero');
  useEffect(() => {
    showing.current = scene;
    setInner(null);
  }, [scene]);
  const onCard = useCallback((card: Card) => {
    if (showing.current === 'does') setInner(card.light);
  }, []);
  const onThread = useCallback((l: Light) => {
    if (showing.current === 'thread') setInner(l);
  }, []);
  useEffect(() => {
    if (scene === 'week' && weekDone) setInner('answered');
  }, [scene, weekDone]);
  useEffect(() => setLight(inner ?? RESTING[scene]), [inner, scene]);

  const hold = (name: SceneName) => (el: HTMLElement | null) => {
    if (el) sections.current.set(name, el);
  };

  // The page's own surface is what the sky arrives at. Until the dawn band it
  // is night, so the sections beside the object are the same dark it stands
  // in; after it, the paper the sky became. One backdrop, graded on the same
  // scroll, rather than two pages stitched together.
  const NIGHT = [7, 10, 16];
  const PAPER = [237, 239, 241];
  const surfaceAt = (k: number) =>
    `rgb(${NIGHT.map((n, i) => Math.round(n + (PAPER[i]! - n) * k)).join(', ')})`;

  return (
    <div
      className="relative"
      style={{ opacity: ready ? 1 : 0, transition: 'opacity 500ms linear' }}
    >
      <div
        aria-hidden
        className="fixed inset-0 -z-10"
        style={{ backgroundColor: surfaceAt(dawn) }}
      />
      <Stage
        at={{ settled, dawn, light, dark: scene === 'thread' ? 0.2 : 0, changeMs: 300 }}
        behind={
          settled < 0.5 ? (
            // The word spans the container with the page's own gutters, as it
            // does on the hero: without them it runs off both edges.
            <div className="absolute inset-0" style={{ opacity: 1 - Math.min(1, settled / 0.5) }}>
              <div className="max-w-page absolute inset-x-0 top-[14svh] mx-auto px-4 md:px-6">
                <Wordmark />
              </div>
            </div>
          ) : null
        }
      />

      <Nav pill={false} />

      {/* 0. The hero: the object at rest, and nothing has happened yet. */}
      <section
        ref={hold('hero')}
        data-scene="hero"
        className="relative z-10 flex h-screen flex-col justify-end"
      >
        <Surface surface="night" transparent className="w-full">
          <div className="max-w-page mx-auto w-full px-4 pb-[9svh] md:px-6">
            <div className="max-w-[34ch]">
              <Display className="text-star [--display-size:44px]">Kalvard {VERBS[verb]}.</Display>
              <p className="text-body text-star/80 mt-4">
                It answers your members, runs your week, and asks a human when it doesn&rsquo;t
                know. Trained on your playbook, live in ten minutes.
              </p>
              <div className="mt-8 flex items-center gap-6">
                <ButtonLink href="/servers">Set up your bot</ButtonLink>
                <TextLink href="#how">See how it learns</TextLink>
              </div>
              <p className="text-ui-sm text-star/55 mt-4">Available on Discord. Slack next.</p>
            </div>
          </div>
        </Surface>
      </section>

      {/* 1. The thread: the promise, proven, then paid off. */}
      <section
        ref={hold('thread')}
        data-scene="thread"
        id="how"
        className="relative z-10 flex min-h-screen items-center px-6 md:px-12"
      >
        <Surface surface="night" transparent className="w-full max-w-[520px]">
          <p className="text-body text-star/80 mb-6 max-w-[44ch]">
            It answers from what your server knows. When it doesn&rsquo;t know, it asks. Then it
            knows.
          </p>
          <Thread playing={scene === 'thread'} onLight={onThread} />
        </Surface>
      </section>

      {/* 2. Dawn: the same place, hours later. Empty on purpose. */}
      <section ref={hold('dawn')} data-scene="dawn" className="relative z-10 h-[60vh]" />

      {/* Everything below sits on the colour the sky arrived at. */}
      <Surface surface="paper" transparent className="relative z-10">
        <div className="md:pr-[42vw]">
          {/* 3. What it does. */}
          <section
            ref={hold('does')}
            data-scene="does"
            className="px-6 py-40 md:px-12"
            aria-label="What it does"
          >
            <Display className="text-ink max-w-[20ch] [--display-size:44px]">
              Four things it does every day.
            </Display>
            <Carousel onCard={onCard} />
          </section>

          {/* 4. It runs the week. */}
          <section ref={hold('week')} data-scene="week" className="px-6 py-40 md:px-12">
            <Display className="text-ink max-w-[20ch] [--display-size:44px]">
              It does the week, not just the answers.
            </Display>
            <RunSummary started={scene === 'week'} onDone={() => setWeekDone(true)} />
          </section>

          {/* 5. Set up by talking. Short: this removes the fear of setup. */}
          <section ref={hold('setup')} data-scene="setup" className="px-6 py-40 md:px-12">
            <Display className="text-ink max-w-[20ch] [--display-size:44px]">
              Set up by talking. Or not.
            </Display>
            <p className="text-body text-ink-soft mt-4 max-w-[60ch]">
              Tell it what your server is for, in your words. It asks about the rest, one question
              at a time, and you&rsquo;re done in about ten minutes. There&rsquo;s a form if
              you&rsquo;d rather.
            </p>
            {/* The setup screen as it stands, drawn from the same components
                rather than photographed: a still of a page that is already in
                the codebase would go stale the day the page changed. */}
            <div className="border-hair bg-night mt-8 overflow-hidden rounded-2xl border p-8">
              <div className="max-w-[46ch]">
                <p className="text-star text-[22px] leading-snug">
                  What should your bot be called?
                </p>
                <div className="mt-6 space-y-3">
                  {SETUP_STILL.map((line) => (
                    <p key={line.q} className="text-ui text-star/55">
                      {line.q} <span className="text-star/85">{line.a}</span>
                    </p>
                  ))}
                </div>
                <div className="border-star/25 mt-6 flex h-11 items-center rounded-lg border px-3">
                  <span className="text-ui text-star/40">Type your answer</span>
                </div>
              </div>
            </div>
          </section>

          {/* 6. Where it fits. */}
          <section ref={hold('fits')} data-scene="fits" className="px-6 py-40 md:px-12">
            <Display className="text-ink max-w-[20ch] [--display-size:44px]">Where it fits</Display>
            <div className="mt-10 grid gap-10 md:grid-cols-3">
              {FITS.map((column) => (
                <div key={column.name}>
                  <p className="text-ink text-[20px]">{column.name}</p>
                  <div className="mt-3 space-y-2">
                    {column.lines.map((line) => (
                      <p key={line} className="text-body text-ink-soft">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-body text-ink mt-10 max-w-[60ch]">
              Kalvard doesn&rsquo;t moderate. Keep your moderation bot; they don&rsquo;t overlap.
            </p>
          </section>

          {/* 7. Pricing. */}
          <section ref={hold('pricing')} data-scene="pricing" className="px-6 py-40 md:px-12">
            <Display className="text-ink max-w-[20ch] [--display-size:44px]">Pricing</Display>
            <div className="mt-10">
              <PricingList>
                {PRICES.map((row) => (
                  <PricingRow key={row.name} name={row.name} line={row.line} price={row.price} />
                ))}
              </PricingList>
            </div>
            <p className="text-ui text-ink-soft mt-4">
              Per server, per month. Cancel anytime. Custom connectors and workflows are quoted on
              any plan.
            </p>
          </section>
        </div>
      </Surface>

      {/* 8. The close: the night it started in, with the light on. */}
      <section
        ref={hold('close')}
        data-scene="close"
        className="relative z-10 flex min-h-screen flex-col justify-end px-6 pb-16 md:px-12"
      >
        <Surface surface="night" transparent className="max-w-[46ch]">
          <p className="text-star text-[20px]">Got it. Next time I&rsquo;ll know.</p>
          <p className="text-body text-star/70 mt-4">
            Named after the vard, the stone beacons that kept watch on Norway&rsquo;s coast.
          </p>
          <div className="mt-8">
            <ButtonLink href="/servers">Set up your bot</ButtonLink>
          </div>
          <div className="text-ui text-star/60 mt-10 flex gap-6">
            <TextLink href="/about">About</TextLink>
            <TextLink href="/pricing">Pricing</TextLink>
            <TextLink href="/how-it-works">How it works</TextLink>
          </div>
        </Surface>
      </section>
    </div>
  );
}
