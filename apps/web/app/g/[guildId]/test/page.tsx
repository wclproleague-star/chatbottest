import { PageTitle } from '@/components/dashboard/page-title';
import { requireMember } from '@/lib/guild';
import { TestPanels } from './test-panels';

// The test chat: the real answer pipeline against this server's knowledge.

export default async function Page({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { supabase } = await requireMember(guildId);
  const { data: settings } = await supabase
    .from('guild_settings')
    .select('bot_name')
    .eq('guild_id', guildId)
    .maybeSingle();

  return (
    <div>
      <PageTitle
        title="Test"
        lede="Ask what a member would ask. Kalvard answers from the knowledge, or shows where it would ask a mod."
      />
      <div className="mt-10">
        <TestPanels guildId={guildId} botName={settings?.bot_name?.trim() || 'Kalvard'} />
      </div>
    </div>
  );
}
