// Typed mirror of supabase/migrations. The migrations are the source of truth;
// when one changes a table, change it here too. Hand-written because
// `supabase gen types --db-url` needs Docker, and because this database is
// shared with another app whose tables have no place in Kalvard's client.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Insert shape: every column, with the defaulted ones optional. */
type Insert<Row, Defaulted extends keyof Row> = Omit<Row, Defaulted> &
  Partial<Pick<Row, Defaulted>>;

export type GuildMemberRole = 'owner' | 'editor';
export type FallbackMode = 'ping_role' | 'quiet_queue';
export type DocumentSourceType = 'upload' | 'paste' | 'qa' | 'mod_answer' | 'channel';
export type DocumentStatus = 'processing' | 'ready' | 'error';
export type QuestionStatus = 'pending' | 'answered' | 'dismissed';
export type AnsweredVia = 'discord' | 'dashboard';
export type BotEventType =
  | 'answered'
  | 'low_confidence'
  | 'mod_pinged'
  | 'approved'
  | 'action'
  | 'install'
  | 'uninstall'
  | 'flagged'
  | 'capability_requested'
  | 'tool_failed'
  | 'settings_issue';
export type OnboardingMode = 'chat' | 'form';

type GuildRow = {
  guild_id: string;
  owner_user_id: string | null;
  name: string | null;
  bot_installed: boolean;
  /** When the bot was removed, if it was. Data is kept for thirty days after. */
  uninstalled_at?: string | null;
  owner_discord_id?: string | null;
  orphaned_at?: string | null;
  installed_at: string | null;
  setup_completed: boolean;
  created_at: string;
};

type UserGuildRow = {
  user_id: string;
  guild_id: string;
  guild_name: string | null;
  guild_icon: string | null;
  can_manage: boolean;
  fetched_at: string;
};

type GuildMemberRow = {
  guild_id: string;
  user_id: string;
  role: GuildMemberRole;
};

type GuildSettingsRow = {
  guild_id: string;
  bot_name: string | null;
  persona_prompt: string | null;
  language: string | null;
  tone_sample: string | null;
  forbidden_topics: string[];
  fallback_mode: FallbackMode;
  mod_role_id: string | null;
  mod_channel_id: string | null;
  match_category: string | null;
  allowed_channel_ids: string[];
  indexed_channel_ids: string[];
  intro_channel_id: string | null;
  intro_message: string | null;
  max_reply_chars: number;
  confidence_threshold: number;
  allowed_actions: string[];
  self_serve_role_ids: string[];
  role_proofs: Json;
  /** The sources this guild can look things up in. See sources.ts. */
  data_sources: Json;
  /** Burst, window, cooldown and the longest message shown to the model. */
  limits: Json;
  scope: 'open' | 'server_only';
  timezone: string | null;
  updated_at: string;
};

type GuildDiscordMetaRow = {
  guild_id: string;
  channels: Json;
  categories: Json;
  roles: Json;
  synced_at: string;
};

type DocumentRow = {
  id: string;
  guild_id: string;
  title: string | null;
  source_type: DocumentSourceType;
  storage_path: string | null;
  raw_text: string | null;
  status: DocumentStatus;
  error_message: string | null;
  chunk_count: number;
  /** Whether the owner still has to decide about personal details found in it. */
  review_status: 'ok' | 'needs_review' | 'approved';
  created_by: string | null;
  created_at: string;
};

type ChunkRow = {
  id: string;
  guild_id: string;
  document_id: string;
  content: string;
  /** pgvector literal, e.g. "[0.1,0.2,...]". 768 dimensions. */
  embedding: string | null;
  token_count: number | null;
  /** Held back because it carries personal details. Never retrieved. */
  blocked: boolean;
  blocked_reason: string | null;
  created_at: string;
};

type QuestionRow = {
  id: string;
  guild_id: string;
  asker_discord_id: string | null;
  asker_name: string | null;
  channel_id: string | null;
  message_id: string | null;
  thread_id: string | null;
  bot_message_id: string | null;
  question: string;
  bot_draft: string | null;
  top_chunk_ids: string[];
  status: QuestionStatus;
  answer: string | null;
  answered_by: string | null;
  answered_via: AnsweredVia | null;
  created_at: string;
  answered_at: string | null;
};

type BotEventRow = {
  id: string;
  guild_id: string;
  type: BotEventType;
  payload: Json;
  created_at: string;
};

type OnboardingSessionRow = {
  id: string;
  guild_id: string;
  user_id: string;
  mode: OnboardingMode;
  messages: Json;
  draft_config: Json;
  step: number;
  completed: boolean;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      guilds: {
        Row: GuildRow;
        Insert: Insert<
          GuildRow,
          | 'owner_user_id'
          | 'name'
          | 'bot_installed'
          | 'installed_at'
          | 'setup_completed'
          | 'created_at'
        >;
        Update: Partial<GuildRow>;
        Relationships: [];
      };
      user_guilds: {
        Row: UserGuildRow;
        Insert: Insert<UserGuildRow, 'guild_name' | 'guild_icon' | 'can_manage' | 'fetched_at'>;
        Update: Partial<UserGuildRow>;
        Relationships: [];
      };
      guild_members: {
        Row: GuildMemberRow;
        Insert: Insert<GuildMemberRow, 'role'>;
        Update: Partial<GuildMemberRow>;
        Relationships: [];
      };
      guild_settings: {
        Row: GuildSettingsRow;
        Insert: Insert<GuildSettingsRow, Exclude<keyof GuildSettingsRow, 'guild_id'>>;
        Update: Partial<GuildSettingsRow>;
        Relationships: [];
      };
      guild_discord_meta: {
        Row: GuildDiscordMetaRow;
        Insert: Insert<GuildDiscordMetaRow, 'channels' | 'roles' | 'synced_at'>;
        Update: Partial<GuildDiscordMetaRow>;
        Relationships: [];
      };
      documents: {
        Row: DocumentRow;
        Insert: Insert<
          DocumentRow,
          | 'id'
          | 'title'
          | 'storage_path'
          | 'raw_text'
          | 'status'
          | 'error_message'
          | 'chunk_count'
          | 'review_status'
          | 'created_by'
          | 'created_at'
        >;
        Update: Partial<DocumentRow>;
        Relationships: [];
      };
      chunks: {
        Row: ChunkRow;
        Insert: Insert<
          ChunkRow,
          'id' | 'embedding' | 'token_count' | 'created_at' | 'blocked' | 'blocked_reason'
        >;
        Update: Partial<ChunkRow>;
        Relationships: [];
      };
      questions: {
        Row: QuestionRow;
        Insert: Insert<
          QuestionRow,
          | 'id'
          | 'asker_discord_id'
          | 'asker_name'
          | 'channel_id'
          | 'message_id'
          | 'thread_id'
          | 'bot_draft'
          | 'top_chunk_ids'
          | 'status'
          | 'answer'
          | 'answered_by'
          | 'answered_via'
          | 'created_at'
          | 'answered_at'
        >;
        Update: Partial<QuestionRow>;
        Relationships: [];
      };
      conversations: {
        Row: {
          guild_id: string;
          key: string;
          turns: Json;
          language: string | null;
          expires_at: string;
          updated_at: string;
        };
        Insert: {
          guild_id: string;
          key: string;
          turns?: Json;
          language?: string | null;
          expires_at: string;
          updated_at?: string;
        };
        Update: { turns?: Json; language?: string | null; expires_at?: string };
        Relationships: [];
      };
      processed_events: {
        Row: { id: string; guild_id: string | null; kind: string; created_at: string };
        Insert: { id: string; guild_id?: string | null; kind: string; created_at?: string };
        Update: { kind?: string };
        Relationships: [];
      };
      workflows: {
        Row: {
          id: string;
          guild_id: string;
          name: string;
          trigger: Json;
          steps: Json;
          checks: Json;
          brief: string | null;
          rules: Json;
          enabled: boolean;
          auto_run: boolean;
          created_by: string | null;
          last_run: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          guild_id: string;
          name: string;
          trigger?: Json;
          steps?: Json;
          checks?: Json;
          brief?: string | null;
          rules?: Json;
          enabled?: boolean;
          auto_run?: boolean;
          created_by?: string | null;
          last_run?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          trigger?: Json;
          steps?: Json;
          checks?: Json;
          brief?: string | null;
          rules?: Json;
          enabled?: boolean;
          auto_run?: boolean;
          last_run?: string | null;
        };
        Relationships: [];
      };
      workflow_runs: {
        Row: {
          id: string;
          guild_id: string;
          workflow_id: string | null;
          started_at: string;
          finished_at: string | null;
          mode: 'live' | 'dry_run';
          status: 'running' | 'done' | 'stopped' | 'failed';
          summary: Json;
          state: Json | null;
          channel_id: string | null;
        };
        Insert: {
          id?: string;
          guild_id: string;
          workflow_id?: string | null;
          started_at?: string;
          finished_at?: string | null;
          mode?: 'live' | 'dry_run';
          status?: 'running' | 'done' | 'stopped' | 'failed';
          summary?: Json;
          state?: Json | null;
          channel_id?: string | null;
        };
        Update: {
          finished_at?: string | null;
          status?: 'running' | 'done' | 'stopped' | 'failed';
          summary?: Json;
          state?: Json | null;
          channel_id?: string | null;
        };
        Relationships: [];
      };
      commands: {
        Row: {
          id: string;
          guild_id: string;
          asked_by: string;
          asked_by_name: string | null;
          request: string;
          plan: Json;
          question: string | null;
          status: 'planned' | 'asked' | 'answered' | 'cancelled' | 'ran' | 'failed';
          ran: Json;
          created_at: string;
          ran_at: string | null;
        };
        Insert: {
          id?: string;
          guild_id: string;
          asked_by: string;
          asked_by_name?: string | null;
          request: string;
          plan?: Json;
          question?: string | null;
          status?: 'planned' | 'asked' | 'answered' | 'cancelled' | 'ran' | 'failed';
          ran?: Json;
          created_at?: string;
          ran_at?: string | null;
        };
        Update: {
          status?: 'planned' | 'asked' | 'answered' | 'cancelled' | 'ran' | 'failed';
          ran?: Json;
          ran_at?: string | null;
        };
        Relationships: [];
      };
      knowledge_conflicts: {
        Row: {
          id: string;
          guild_id: string;
          chunk_a: string;
          chunk_b: string;
          first: string;
          second: string;
          resolved: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          guild_id: string;
          chunk_a: string;
          chunk_b: string;
          first: string;
          second: string;
          resolved?: boolean;
          created_at?: string;
        };
        Update: {
          resolved?: boolean;
          first?: string;
          second?: string;
        };
        Relationships: [];
      };
      bot_events: {
        Row: BotEventRow;
        Insert: Insert<BotEventRow, 'id' | 'payload' | 'created_at'>;
        Update: Partial<BotEventRow>;
        Relationships: [];
      };
      onboarding_sessions: {
        Row: OnboardingSessionRow;
        Insert: Insert<
          OnboardingSessionRow,
          'id' | 'messages' | 'draft_config' | 'step' | 'completed' | 'created_at' | 'updated_at'
        >;
        Update: Partial<OnboardingSessionRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_chunks: {
        Args: {
          guild_id: string;
          /** pgvector literal, 768 dimensions. */
          query_embedding: string;
          match_count: number;
          min_similarity: number;
        };
        Returns: {
          id: string;
          content: string;
          document_id: string;
          similarity: number;
        }[];
      };
    };
    Enums: {
      guild_member_role: GuildMemberRole;
      fallback_mode: FallbackMode;
      document_source_type: DocumentSourceType;
      document_status: DocumentStatus;
      question_status: QuestionStatus;
      answered_via: AnsweredVia;
      bot_event_type: BotEventType;
      onboarding_mode: OnboardingMode;
    };
    CompositeTypes: Record<string, never>;
  };
};
