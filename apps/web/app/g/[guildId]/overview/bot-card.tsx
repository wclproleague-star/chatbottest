'use client';

// The bot card from onboarding, reused here at its end state. It is a client
// component only because the card animates when it fills; on Overview there is
// nothing to fill, so it renders as it will always look.

import { BotCard } from '@sentrybot/ui';
import type { BotCardValues } from '@sentrybot/ui';

export function OwnerBotCard({ values }: { values: BotCardValues }) {
  return <BotCard values={values} filled bare />;
}
