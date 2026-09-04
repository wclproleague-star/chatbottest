-- Nearest-neighbour lookup over one guild's chunks.
--
-- SECURITY INVOKER on purpose: with RLS on public.chunks, an authenticated
-- caller can only ever match chunks for guilds they belong to, and the bot
-- reaches it through the service role. search_path is pinned empty, so every
-- name below is schema-qualified, including the cosine distance operator.

create or replace function public.match_chunks(
  guild_id text,
  query_embedding extensions.vector(768),
  match_count integer,
  min_similarity double precision
)
returns table (
  id uuid,
  content text,
  document_id uuid,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.content,
    c.document_id,
    1 - (c.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.chunks c
  where c.guild_id = match_chunks.guild_id
    and c.embedding is not null
    and 1 - (c.embedding operator(extensions.<=>) query_embedding) >= min_similarity
  order by c.embedding operator(extensions.<=>) query_embedding
  limit match_count;
$$;

-- Postgres grants EXECUTE to PUBLIC by default; anon has no business here.
revoke execute on function public.match_chunks(
  text, extensions.vector, integer, double precision
) from public, anon;

grant execute on function public.match_chunks(
  text, extensions.vector, integer, double precision
) to authenticated, service_role;
