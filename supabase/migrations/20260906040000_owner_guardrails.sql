-- What an owner can do to their own server, and what happens when they leave.
--
-- Knowledge can contain a member's phone number or address. It is found at
-- ingest, the chunk is blocked, and nothing blocked is ever retrieved: the
-- owner sees it in the dashboard and decides. match_chunks is replaced rather
-- than filtered by the caller, so no query can forget.
--
-- Settings carry their own updated_at into the save, so two people editing at
-- once cannot silently overwrite one another.
--
-- An owner who leaves Discord leaves the guild without one; it is marked, and
-- the editors are asked to claim it.

alter table public.chunks
  add column blocked boolean not null default false,
  add column blocked_reason text;

alter table public.documents
  add column review_status text not null default 'ok'
    check (review_status in ('ok', 'needs_review', 'approved'));

alter table public.guilds
  add column owner_discord_id text,
  add column orphaned_at timestamptz;

create index chunks_blocked_idx on public.chunks (guild_id) where blocked;

create or replace function public.match_chunks(
  guild_id text,
  query_embedding vector(768),
  match_count int,
  min_similarity float
)
returns table (id uuid, content text, document_id uuid, similarity float)
language sql
stable
as $$
  select c.id, c.content, c.document_id, 1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  where c.guild_id = match_chunks.guild_id
    and not c.blocked
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
