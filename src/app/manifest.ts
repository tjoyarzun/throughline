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
      // "any" and "maskable" are listed separately on purpose: a launcher that
      // crops a non-maskable icon to a circle clips the mark.
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
