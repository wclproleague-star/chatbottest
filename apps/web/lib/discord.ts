// Discord's guild list for the signed-in user. Only reachable with the
// provider token Supabase hands over at login, which is why user_guilds is
// filled then and not later.

const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;

export type DiscordGuild = {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
};

export type ManagedGuild = DiscordGuild & { canManage: boolean };

export async function fetchDiscordGuilds(providerToken: string): Promise<ManagedGuild[]> {
  const res = await fetch('https://discord.com/api/v10/users/@me/guilds', {
    headers: { Authorization: `Bearer ${providerToken}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Discord answered ${res.status} for /users/@me/guilds.`);
  const guilds = (await res.json()) as DiscordGuild[];
  return guilds.map((g) => ({
    ...g,
    canManage: g.owner || (BigInt(g.permissions) & (MANAGE_GUILD | ADMINISTRATOR)) !== 0n,
  }));
}

export function guildIconUrl(guildId: string, icon: string | null, size = 64): string | null {
  return icon ? `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=${size}` : null;
}
