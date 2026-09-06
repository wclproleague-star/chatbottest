# Kalvard

The spec lives in [CLAUDE.md](CLAUDE.md). Read it first.

## Run it

```
pnpm install
cp .env.example .env    # fill in what you need
pnpm dev                # web on :3000, bot worker
```

Single apps: `pnpm dev:web`, `pnpm dev:bot`.

## Check it

```
pnpm typecheck
pnpm lint
pnpm format
pnpm build
```
