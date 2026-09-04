import { GoogleGenAI, Type } from '@google/genai';
import type { Schema } from '@google/genai';
import { env } from './env';

export { Type };
export type { Schema };

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
    const response = await ai().models.embedContent({
      model: env().geminiEmbedModel,
      contents: batch,
      config: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS },
    });
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
}): Promise<T> {
  const response = await ai().models.generateContent({
    model: env().geminiModel,
    contents: input.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    config: {
      systemInstruction: input.system,
      responseMimeType: 'application/json',
      responseSchema: input.schema,
      temperature: input.temperature ?? 0.2,
    },
  });
  const text = response.text;
  if (!text) throw new Error('Gemini returned an empty response.');
  return JSON.parse(text) as T;
}
