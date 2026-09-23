import type { MetadataRoute } from 'next';

/**
 * The web app manifest.
 *
 * Without one, "Add to Home Screen" produces a bookmark with a screenshot for
 * an icon rather than an installed app. `display: standalone` is what drops
 * the Safari chrome; `scope` is what keeps navigation inside the installed
 * window instead of kicking out to the browser.
 *
 * background_color is the color painted BEFORE the page renders, so it must
 * match the app background or the launch flashes white. It cannot respond to
 * the color scheme -- the manifest is static -- so it takes the dark value,
 * which is both the default and the one used at night.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Throughline',
    short_name: 'Throughline',
    description: 'A media tracker that understands how things connect.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0B0C0E',
    theme_color: '#0B0C0E',
    categories: ['entertainment', 'utilities'],
    icons: [
      /**
       * Separate FILES, not just separate entries.
       *
       * These four used to be two PNGs listed twice, which made the
       * declaration a lie and the result wrong in both directions: launchers
       * that crop to a circle shaved the mark (measured -- it reached 0.406 of
       * the canvas from center against a 0.4 safe radius), while platforms
       * that do not crop drew it floating inside padding it did not need.
       * The maskable pair now carries the safe-zone inset; the "any" pair
       * fills its tile.
       */
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
