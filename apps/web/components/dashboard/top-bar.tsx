import { Wordmark } from '@kalvard/ui';

/**
 * The app's top bar on paper: wordmark left, sign out right. The 240px
 * sidebar arrives with the guild pages at line 12; /servers has no guild yet.
 */
export function TopBar({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="max-w-page mx-auto flex h-16 items-center justify-between px-6">
      <a href="/" className="text-ui text-ink">
        <Wordmark />
      </a>
      {signedIn && (
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="text-ui text-ink-soft hover:text-ink decoration-ink/40 hover:decoration-ink underline underline-offset-[3px] transition-colors"
          >
            Sign out
          </button>
        </form>
      )}
    </header>
  );
}
