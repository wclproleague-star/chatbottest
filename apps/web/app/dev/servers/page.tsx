import { Servers } from '@/app/servers/servers';

// The servers screen with fixed data, so all four states can be looked at at
// once without four real servers behind them.

export default function Page() {
  return (
    <Servers
      manageable={[
        {
          guildId: '1',
          name: 'Wild Champions League',
          icon: null,
          claimed: true,
          light: 'green',
          line: '34 answers this week, 2 waiting on you',
        },
        {
          guildId: '2',
          name: 'Rift Legends EU',
          icon: null,
          claimed: true,
          light: 'amber',
          line: '11 answers this week, nothing waiting on you',
        },
        {
          guildId: '3',
          name: 'Fast Forward',
          icon: null,
          claimed: true,
          light: 'working',
          line: 'Carrying something out right now',
        },
        {
          guildId: '4',
          name: 'Sunday Scrims',
          icon: null,
          claimed: false,
          light: 'off',
          line: 'Not set up yet',
        },
      ]}
      others={[
        { guildId: '5', name: 'Wild Rift France' },
        { guildId: '6', name: 'Patch Notes' },
        { guildId: '7', name: 'Coaching corner' },
      ]}
    />
  );
}
