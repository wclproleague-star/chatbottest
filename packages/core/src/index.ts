// The AI pipeline and the typed Supabase client. Server side and the bot only.
// onboard arrives with build order line 11.

export {
  answer,
  ACTION_TYPES,
  FLAG_CATEGORIES,
  GROUNDINGS,
  HISTORY_LIMIT,
  KINDS,
  MODS,
} from './answer';
export type {
  Action,
  ActionType,
  AnswerInput,
  AnswerResult,
  Claim,
  FlagCategory,
  Grounding,
  HistoryTurn,
  Kind,
} from './answer';

export { suggestQuestions } from './suggest';
export type { SuggestInput, SuggestResult } from './suggest';

export {
  converse,
  hasOpenConversation,
  rememberMemberName,
  MAX_TOOL_CALLS,
  CONVERSATION_TTL_MS,
} from './agent';
export type { ConversationInput, ConversationResult, Effects, RoleProof } from './agent';

export { ingest } from './ingest';
export type { IngestInput, IngestResult } from './ingest';

export { chunkText, estimateTokens } from './chunk';
export type { Chunk, ChunkOptions } from './chunk';

export { extractText } from './extract';
export { embed, EMBEDDING_DIMENSIONS } from './gemini';
export type { EmbedTask } from './gemini';

export { registerFetcher, parseSources, runnable } from './sources';
export type { DataSource, Fetcher } from './sources';

export { serviceClient, DOCUMENTS_BUCKET } from './supabase';
export type { ServiceClient } from './supabase';

export type * from './database.types';
