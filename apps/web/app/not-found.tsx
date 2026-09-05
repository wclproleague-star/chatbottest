import { Display, Surface, TextLink } from '@sentrybot/ui';

/** 404: paper, the headline, and a link home. */
export default function NotFound() {
  return (
    <Surface surface="paper" className="min-h-screen">
      <main className="max-w-page mx-auto px-6 pt-24">
        <Display className="[--display-size:40px]">Not sure about that one.</Display>
        <p className="mt-6">
          <TextLink href="/">Back to the start</TextLink>
        </p>
      </main>
    </Surface>
  );
}
