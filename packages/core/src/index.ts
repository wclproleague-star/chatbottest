// The AI pipeline and the typed Supabase client. Server side and the bot only.

export {
  planCommand,
  runPlan,
  describePlan,
  recordCommand,
  cancelCommand,
  COMMAND_ACTIONS,
  ITEMISE_ABOVE,
} from './command';
export type {
  Plan,
  PlannedStep,
  ExecutedStep,
  CommandEffects,
  CommandAction,
  Commander,
  GuildShape,
} from './command';

export { runWorkflow, recordRun, WORKFLOW_ACTIONS } from './workflows';
export type { Workflow, WorkflowEffects, RunResult, Step } from './workflows';

export { MATCH_DAY, matchDayContext } from './workflows/match-day';

export { authorWorkflow, checkStep, readBack, whatChanged } from './workflow-author';
export type { Checked, Draft, RawStep, WorkflowShape } from './workflow-author';

export {
  onboard,
  missing,
  applyAnswer,
  toneSamples,
  decided,
  AREAS,
  DEFAULT_FORBIDDEN,
} from './onboard';
export type { DraftConfig, OnboardMessage, OnboardResult } from './onboard';

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
export { sweepConversations } from './agent';
export type { ConversationInput, ConversationResult, Effects, RoleProof, WouldHave } from './agent';

export { ingest } from './ingest';
export type { IngestInput, IngestResult } from './ingest';

export { chunkText, estimateTokens } from './chunk';
export type { Chunk, ChunkOptions } from './chunk';

export { extractText } from './extract';
export { embed, EMBEDDING_DIMENSIONS } from './gemini';
export type { EmbedTask } from './gemini';

export { forgetPerson } from './forget';
export type { ForgetReport } from './forget';

export { saveSettings, approveDocument, needsOwner } from './settings';
export type { SaveOutcome, SettingsPatch } from './settings';

export { checkPersona, checkForbidden } from './persona';
export type { PersonaVerdict } from './persona';

export { findPersonal, personalSummary } from './personal';
export type { Finding, PersonalKind } from './personal';

export { inZone, clockIn, pastRetention, RETENTION_DAYS } from './times';

export {
  classify,
  worthRetrying,
  backoffMs,
  withRetry,
  outageReply,
  DEFAULT_RETRY,
} from './resilience';
export type { ErrorClass, RetryOptions } from './resilience';

export { allowMessage, forgetMember, forModel, parseLimits, DEFAULT_LIMITS } from './limits';
export type { Limits } from './limits';

export { registerFetcher, parseSources, runnable, testSource, kinds } from './sources';
export type { DataSource, Fetcher } from './sources';

export { serviceClient, DOCUMENTS_BUCKET } from './supabase';
export type { ServiceClient } from './supabase';

export type * from './database.types';
