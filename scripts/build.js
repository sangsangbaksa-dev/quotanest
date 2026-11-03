/* Writes sitemap.xml and robots.txt from config.js, and with --dist copies the public files to dist/ (Cloudflare Pages output).
   Run: node scripts/build.js [--dist]. No dependencies. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const sb = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), sb);
const base = sb.window.QN_SITE.siteUrl.replace(/\/+$/, '');
const put = (rel, text) => fs.writeFileSync(path.join(root, rel), text);
put('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${base}/</loc></url>\n<url><loc>${base}/privacy.html</loc></url>\n<url><loc>${base}/terms.html</loc></url>\n</urlset>\n`);
put('robots.txt', `User-agent: *\nAllow: /\nDisallow: /app/\n\nSitemap: ${base}/sitemap.xml\n`);
console.log('built for', base);
if (process.argv.includes('--dist')) {
  const out = path.join(root, 'dist');
  fs.rmSync(out, { recursive: true, force: true });
  const items = ['index.html', 'privacy.html', 'terms.html', 'landing.css', 'landing.js', 'i18n.js', 'config.js', 'icon.svg', 'sitemap.xml', 'robots.txt', '_headers', 'app'];
  for (const f of items) {
    const to = path.join(out, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(path.join(root, f), to, { recursive: true });
  }
  console.log('dist ready:', items.length, 'entries');
}
