import { GoogleGenAI, Type } from '@google/genai';
import { withRetry } from './resilience';
import type { Content, FunctionDeclaration, Schema } from '@google/genai';
import { env } from './env';

export { Type };
export type { FunctionDeclaration, Schema };

/** pgvector's HNSW index caps at 2000 dims; the model's default 3072 would not index. */
export const EMBEDDING_DIMENSIONS = 768;

/** Gemini accepts many contents per embedContent call; keep requests modest. */
const EMBED_BATCH = 50;

let client: GoogleGenAI | undefined;

function ai(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: env().geminiApiKey });
  return client;
}

export type EmbedTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/** Embeds texts at 768 dims, unit-normalised, in input order. */
export async function embed(texts: string[], taskType: EmbedTask): Promise<number[][]> {
  const out: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH) {
    const batch = texts.slice(start, start + EMBED_BATCH);
    const response = await withRetry(() =>
      ai().models.embedContent({
        model: env().geminiEmbedModel,
        contents: batch,
        config: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS },
      }),
    );
    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(
        `Gemini returned ${embeddings.length} embeddings for ${batch.length} inputs.`,
      );
    }
    for (const embedding of embeddings) {
      const values = embedding.values;
      if (!values || values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Gemini returned an embedding of ${values?.length ?? 0} dims, expected ${EMBEDDING_DIMENSIONS}.`,
        );
      }
      out.push(normalise(values));
    }
  }
  return out;
}

// Google recommends normalising when outputDimensionality is below the native size.
function normalise(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? vector : vector.map((x) => x / norm);
}

export type ChatTurn = { role: 'user' | 'model'; text: string };

/** One structured-output call to the chat model. The schema is enforced by Gemini. */
export async function generateJson<T>(input: {
  system: string;
  messages: ChatTurn[];
  schema: Schema;
  temperature?: number;
  /** A ceiling on the answer. A model that runs away writes junk, not JSON. */
  maxOutputTokens?: number;
}): Promise<T> {
  const response = await withRetry(() =>
    ai().models.generateContent({
      model: env().geminiModel,
      contents: input.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      config: {
        systemInstruction: input.system,
        responseMimeType: 'application/json',
        responseSchema: input.schema,
        temperature: input.temperature ?? 0.2,
        ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
      },
    }),
  );
  const text = response.text;
  if (!text) throw new Error('Gemini returned an empty response.');
  try {
    return JSON.parse(text) as T;
  } catch {
    // Seen live: a name it did not know, repeated until the output ran out.
    throw new Error(
      `Gemini did not return JSON (${text.length} characters): ${text.slice(0, 400)}`,
    );
  }
}

/** One step of a tool-using conversation: what the model said, and what it wants to call. */
export type ToolStep = {
  text: string;
  calls: { name: string; args: Record<string, unknown> }[];
  /** The model's own turn, kept as it came: its parts carry signatures the API requires back. */
  content: Content;
};

/** A turn in a tool-using conversation, as the model sees it. */
export type ToolTurn =
  | { role: 'user' | 'model'; text: string }
  | { model: Content }
  | { role: 'tool'; name: string; result: unknown };

/**
 * One call to the chat model with tools available. The caller runs the loop:
 * it executes whatever comes back in `calls`, appends the results as `tool`
 * turns, and calls again. Nothing here executes anything.
 */
export async function generateWithTools(input: {
  system: string;
  turns: ToolTurn[];
  tools: FunctionDeclaration[];
  temperature?: number;
}): Promise<ToolStep> {
  const response = await withRetry(() =>
    ai().models.generateContent({
      model: env().geminiModel,
      contents: input.turns.map(toContent),
      config: {
        systemInstruction: input.system,
        tools: [{ functionDeclarations: input.tools }],
        temperature: input.temperature ?? 0.6,
      },
    }),
  );
  const content = response.candidates?.[0]?.content ?? { role: 'model', parts: [] };
  return {
    content,
    text: (response.text ?? '').trim(),
    calls: (response.functionCalls ?? []).map((c) => ({
      name: c.name ?? '',
      args: (c.args ?? {}) as Record<string, unknown>,
    })),
  };
}

function toContent(turn: ToolTurn): Content {
  if ('model' in turn) return turn.model;
  if (turn.role === 'tool') {
    return {
      role: 'user',
      parts: [{ functionResponse: { name: turn.name, response: { result: turn.result } } }],
    };
  }
  return { role: turn.role, parts: [{ text: turn.text }] };
}
