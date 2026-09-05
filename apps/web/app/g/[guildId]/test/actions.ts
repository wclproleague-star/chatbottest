'use server';

import { answer, suggestQuestions } from '@sentrybot/core';
import type { AnswerResult, HistoryTurn } from '@sentrybot/core';
import { displayName, requireMember } from '@/lib/guild';

// The test chat's two calls: ask, which runs the real answer pipeline, and
// suggest, which reads the knowledge and proposes questions to try.

export type AskResult = { result: AnswerResult } | { error: string };
export type SuggestOutcome = { questions: string[] } | { error: string };

const MAX_QUESTION = 500;
const MAX_HISTORY = 12;

export async function ask(
  guildId: string,
  question: string,
  history: HistoryTurn[],
): Promise<AskResult> {
  const q = question.trim().slice(0, MAX_QUESTION);
  if (!q) return { error: 'Ask something first.' };
  const { user } = await requireMember(guildId);
  try {
    const result = await answer({
      guildId,
      question: q,
      askerName: displayName(user),
      history: history.slice(-MAX_HISTORY),
    });
    return { result };
  } catch {
    return { error: 'Sentry could not answer just now. Try again in a moment.' };
  }
}

export async function suggest(guildId: string): Promise<SuggestOutcome> {
  await requireMember(guildId);
  try {
    const { questions, unanswerable } = await suggestQuestions({ guildId });
    return { questions: unanswerable ? [...questions, unanswerable] : questions };
  } catch {
    return { error: 'Could not think of questions just now. Try again in a moment.' };
  }
}
