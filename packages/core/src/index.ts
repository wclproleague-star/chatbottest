// The AI pipeline and the typed Supabase client. Server side and the bot only.

export {
  planCommand,
  runPlan,
  describePlan,
  recordCommand,
  cancelCommand,
  COMMAND_ACTIONS,
  ITEMISE_ABOVE,
  pendingCommandQuestion,
  answerCommandQuestion,
  withAnswer,
  nameOf,
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

export {
  runWorkflow,
  recordRun,
  listWorkflows,
  getWorkflow,
  saveWorkflow,
  setWorkflowEnabled,
  listRuns,
  runDryEffects,
  WORKFLOW_ACTIONS,
} from './workflows';
export type {
  Workflow,
  WorkflowEffects,
  RunResult,
  RunState,
  RunEvent,
  Delivery,
  Step,
} from './workflows';
export { resumeWorkflow, saveRun, pausedRuns } from './workflows';
export { BO3_SERIES, seriesContext } from './workflows/series';
export type { SeriesContext } from './workflows/series';
export { readEndScreen } from './vision';
export type { EndScreen } from './vision';
export { runOp } from './sources';
export { resetDraftFixture, FIXTURE_LOOKS_TO_DONE, draftCard } from './fetchers/draft-flow';
export type { DraftSession } from './fetchers/draft-flow';

export { MATCH_DAY, matchDayContext } from './workflows/match-day';
export {
  TEMPLATES,
  TOURNAMENT_WEEK,
  WEEKLY_ANNOUNCEMENT,
  MEMBER_ONBOARDING,
} from './workflows/templates';

export { authorWorkflow, checkStep, readBack, whatChanged } from './workflow-author';
export { isDue, lastDue, readSchedule } from './schedule';
export { answersHere } from './answers-here';
export { answersTheQuestion } from './conversation';
export { aboutARole, asksForRole, namedRoles, whichRole } from './roles';
export { appendVouch, onRoster, rosterTitle, vouchDocument } from './vouch';
export { isVouched, recordVouch } from './vouch-store';
export type { Vouch } from './vouch';
export type { RoleMatch } from './roles';
export { findRepeat, offer } from './repeats';
export type { CommandRecord, Repeat } from './repeats';
export type { Schedule } from './schedule';
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
export { searchKnowledge } from './agent';
export { keep, guard, memoryOf, defaultBrief, QUIET_MS } from './keeper';
export type { KeeperInput, KeeperDecision } from './keeper';
export {
  dueToPrepare,
  channelNameFor,
  teamRole,
  startTimeIn,
  LEAD_HOURS,
  DEFAULT_MATCH_CATEGORY,
} from './matches';
export type { UpcomingMatch } from './matches';
export { riftMatchesBetween, reportResult } from './fetchers/rift-legends';
export type { RiftMatch, RiftTeam } from './fetchers/rift-legends';
export {
  nextSupportQuestion,
  supportPlan,
  loadSupport,
  saveSupport,
  nextTicketNumber,
  DEFAULT_TICKET_KINDS,
} from './support';
export type { SupportMode, SupportAnswers, SupportQuestion, SupportSetup } from './support';
export { SUPPORT_ACTIONS } from './command';
export type { SupportAction } from './command';
export { gapIn } from './onboard';
export { resolveDates, confirmLine, believable, readableDay, todayIn } from './dates';
export type { Resolution, ResolvedDate } from './dates';
export { datesIn, whenLines, spell } from './when';
export { learnFrom, keepsOnlyWhatWasSaid, numbersIn } from './learn';
export { markHeadings, headingLevel, prepare } from './outline';
export { describeDocument, sourceLine, usable } from './describe';
export { withStaleness } from './stale';
export type { Outline } from './outline';
export type { Learned } from './learn';
export type { Dated } from './when';
