// The AI pipeline and the typed Supabase client. Server side and the bot only.
// onboard and suggestQuestions arrive with build order lines 11 and 9.

export { answer, ACTION_TYPES } from './answer';
export type { Action, ActionType, AnswerInput, AnswerResult, HistoryTurn } from './answer';

export { ingest } from './ingest';
export type { IngestInput, IngestResult } from './ingest';

export { chunkText, estimateTokens } from './chunk';
export type { Chunk, ChunkOptions } from './chunk';

export { extractText } from './extract';
export { embed, EMBEDDING_DIMENSIONS } from './gemini';
export type { EmbedTask } from './gemini';

export { serviceClient, DOCUMENTS_BUCKET } from './supabase';
export type { ServiceClient } from './supabase';

export type * from './database.types';
