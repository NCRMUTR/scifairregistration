import { defineConfig, loadEnv } from 'vite';

/**
 * Content-Security-Policy for the PRODUCTION build only (GitHub Pages cannot send headers, so it goes in a <meta> tag;
 * frame-ancestors is not available that way — main.js refuses to run inside a frame instead).
 *
 * Why each source is there:
 *  script-src   only our own bundle: markup injected into a page can never run a script
 *  connect-src  the Apps Script Web App (script.google.com answers with a redirect to script.googleusercontent.com)
 *               and www.googleapis.com, where the browser PUTs uploads (Drive resumable upload URL)
 *  img-src      Drive thumbnails (drive.google.com redirects to *.googleusercontent.com), data:/blob: for the slip PNG
 *  frame-src    the project PDF preview in the "รายละเอียดโครงการ" window
 *  style-src    'unsafe-inline' because pages set style="…" attributes; it does not allow scripts
 * The Web App origin from VITE_GAS_URL is added automatically, so a non-Google test backend also works in a test build.
 */
function contentSecurityPolicy(gasUrl) {
  let gasOrigin = '';
  try {
    gasOrigin = new URL(gasUrl).origin;
  } catch {
    /* not configured: the page shows its own setup error */
  }
  const google = ['https://script.google.com', 'https://script.googleusercontent.com', 'https://www.googleapis.com'];
  const connect = [...new Set(["'self'", ...google, gasOrigin].filter(Boolean))];
  const img = [...new Set(["'self'", 'data:', 'blob:', 'https://drive.google.com', 'https://*.googleusercontent.com', gasOrigin].filter(Boolean))];
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    `img-src ${img.join(' ')}`,
    `connect-src ${connect.join(' ')}`,
    'frame-src https://drive.google.com https://docs.google.com https://*.googleusercontent.com',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

// base './' keeps asset URLs relative so the site works on https://<user>.github.io/<repo>/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: './',
    build: { outDir: 'dist', sourcemap: false },
    plugins: [
      {
        name: 'csp-meta',
        apply: 'build',
        transformIndexHtml: {
          order: 'post',
          handler: (html) =>
            html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(env.VITE_GAS_URL || '')}" />`),
        },
      },
    ],
  };
});
