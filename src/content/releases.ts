/**
 * What changed, in the reader's language.
 *
 * A TypeScript file, not a table. Release notes change exactly when the code
 * changes, so they belong in the deploy rather than in a database somebody has
 * to remember to write to afterwards — and one that drifts from what actually
 * shipped is worse than none.
 *
 * WRITTEN FOR THE OTHER USERS, not for me. The two people who use this are not
 * going to read a commit log or a Slack post, and "we improved performance" is
 * a sentence that has never helped anybody. Each line says what they can now
 * do, in a tone that sounds like a person.
 */

export type Kind = 'new' | 'better' | 'fixed';

export interface ReleaseItem {
  kind: Kind;
  title: string;
  body: string;
  /** Where to go and try it. Optional — not everything has a destination. */
  href?: string;
}

export interface Release {
  /** ISO, so it sorts. Rendered in the reader's locale. */
  date: string;
  /** A short name, not a version number. Nobody has asked what version it is. */
  name: string;
  /** One line under the name. Sets up the list; never repeats it. */
  summary: string;
  items: ReleaseItem[];
}

export const RELEASES: Release[] = [
  {
    date: '2026-09-23',
    name: 'It tells you what to watch',
    summary: 'And, more to the point, why.',
    items: [
      {
        kind: 'new',
        title: 'Worth your time',
        body:
          'Suggestions on your home screen, each one showing its reasoning — "Terence Winter, ' +
          'wrote 3 you\'ve seen". You can go and check it, which is the whole idea. An early ' +
          'version recommended Superman IV: The Quest for Peace on the grounds that it is science ' +
          'fiction and also action. It has since been talked out of this.',
        href: '/',
      },
      {
        kind: 'better',
        title: 'The Universe opens on the graph',
        body:
          'It used to be three cards describing a graph. Now it is the graph, with everything ' +
          'you have watched glowing gold inside it. Tap any node to walk to it.',
        href: '/universe',
      },
      {
        kind: 'new',
        title: 'Share it without an account',
        body:
          'Any person, film, studio or theme now has a public page you can send to anyone. No ' +
          'login, no signup, nothing to install.',
        href: '/explore',
      },
      {
        kind: 'new',
        title: 'Light mode, dark mode, or whatever your phone is doing',
        body: 'Set per device, so your phone at night and your laptop at work can disagree.',
        href: '/me',
      },
      {
        kind: 'new',
        title: 'Filter your library by genre',
        body:
          'Only the genres you actually have, with counts — so no filter ever takes you to an ' +
          'empty shelf.',
        href: '/library',
      },
      {
        kind: 'fixed',
        title: 'Back goes back',
        body:
          'It now returns to the screen you came from, and tells you which one that is, instead ' +
          'of guessing. Installed on a phone there is no browser back button, so this was more ' +
          'annoying than it sounds.',
      },
      {
        kind: 'better',
        title: 'Everybody has a biography now',
        body:
          'All 59,000 people in the database have their details filled in. It was at 1.8% and ' +
          'was on course to finish somewhere around February.',
      },
    ],
  },
  {
    date: '2026-09-22',
    name: 'Where to watch',
    summary: 'The two things most likely to make you open the app on a Tuesday.',
    items: [
      {
        kind: 'new',
        title: 'What is streaming it',
        body:
          'Every film and show now shows where you can watch it in your region, and Library has ' +
          'a Streaming sort for when you want something you can actually press play on tonight.',
        href: '/library',
      },
      {
        kind: 'fixed',
        title: 'Popular right now is finally right now',
        body:
          'It had been showing the same eighteen posters since the day the database was seeded. ' +
          'It was, technically, a list.',
        href: '/search',
      },
      {
        kind: 'better',
        title: 'Explore starts somewhere yours',
        body:
          'The starting points now come from your own library first, then what is trending — ' +
          'rather than the same frozen ranking for everybody.',
        href: '/universe/explore',
      },
    ],
  },
];
