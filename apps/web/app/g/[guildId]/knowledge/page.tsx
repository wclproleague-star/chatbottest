import { requireMember } from '@/lib/guild';
import { formatDate } from '@/lib/format';
import { Knowledge } from './knowledge';

// The queries behind the knowledge page. What it looks like is in ./knowledge.

export default async function Page({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { supabase } = await requireMember(guildId);

  const [{ data: documents }, { count }] = await Promise.all([
    supabase
      .from('documents')
      .select('id, title, source_type, status, error_message, chunk_count, created_at')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false }),
    supabase.from('chunks').select('id', { count: 'exact', head: true }).eq('guild_id', guildId),
  ]);

  return (
    <Knowledge
      guildId={guildId}
      chunks={count ?? 0}
      documents={(documents ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        sourceType: d.source_type,
        status: d.status,
        chunkCount: d.chunk_count,
        error: d.error_message,
        addedAt: formatDate(d.created_at),
      }))}
    />
  );
}
