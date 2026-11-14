// Build the artifact page: Parcel bundle -> one HTML fragment for the claude.ai Artifact tool.
// The Artifact tool adds <!doctype>/<html>/<head>/<body> itself, so we emit content only,
// with the artifact-notes block right after <title> (agents read the first ~16k chars).
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
rmSync(join(root, 'dist'), { recursive: true, force: true });
execSync('pnpm exec parcel build index.html --dist-dir dist --no-source-maps --no-cache', { cwd: root, stdio: 'inherit' });

const src = readFileSync(join(root, 'index.html'), 'utf8'); // head tags come from the source, quoted
const notes = readFileSync(join(root, 'ARTIFACT_NOTES.md'), 'utf8').trim();
if (/<\/script/i.test(notes)) throw new Error('ARTIFACT_NOTES.md must not contain </script>');

const title = /<title>[\s\S]*?<\/title>/.exec(src)[0];
const metas = [...src.matchAll(/<meta name="claude:[^>]*>/g)].map((m) => m[0]);
const remoteLinks = [...src.matchAll(/<link[^>]+href="https:[^"]+"[^>]*>/g)].map((m) => m[0]);
const files = readdirSync(join(root, 'dist'));
const styles = files.filter((f) => f.endsWith('.css'))
  .map((f) => `<style>${readFileSync(join(root, 'dist', f), 'utf8')}</style>`);
const scripts = files.filter((f) => f.endsWith('.js')).map((f) => {
  const js = readFileSync(join(root, 'dist', f), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
if (scripts.length !== 1 || styles.length !== 1) throw new Error(`expected 1 js + 1 css, got ${scripts.length} + ${styles.length}`);

const out = [
  title,
  `<script type="text/markdown" id="artifact-notes">\n${notes}\n</script>`,
  ...metas,
  ...remoteLinks,
  ...styles,
  '<div id="root"></div>',
  ...scripts,
].join('\n');
writeFileSync(join(root, 'artifact.html'), out + '\n');
console.log(`artifact.html: ${(out.length / 1024).toFixed(1)} KiB, ${scripts.length} script(s), ${styles.length} style(s)`);
