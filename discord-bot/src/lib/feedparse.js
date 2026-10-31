/**
 * Minimal RSS 2.0 / Atom parser (no dependencies). Good enough for YouTube channel feeds,
 * RSS-Bridge output, GitHub Atom feeds and blogs: returns items with id, title, link, date,
 * author, summary and an image when the feed carries one.
 */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function cdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/** Text content of the first <tag> (namespaced names allowed: "media:title"). */
function tagText(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(xml);
  return m ? decodeEntities(cdata(m[1])).trim() : '';
}

function attr(xml, tag, name, where) {
  const re = new RegExp(`<${tag}\\b([^>]*)/?>`, 'gi');
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    if (where && !where(attrs)) continue;
    const a = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
    if (a) return decodeEntities(a[2] ?? a[3]);
  }
  return '';
}

export function stripHtml(html) {
  return decodeEntities(String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/\n{3,}/g, '\n\n').trim();
}

function blocks(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function toDate(s) {
  const d = Date.parse(s);
  return Number.isFinite(d) ? d : null;
}

/** @returns {{ title:string, link:string, items:Array<{id,title,link,date,author,summary,image,videoId}> }} */
export function parseFeed(xml) {
  const text = String(xml || '');
  const isAtom = /<feed[\s>]/i.test(text) && !/<rss[\s>]/i.test(text);
  if (isAtom) {
    const head = text.split(/<entry[\s>]/i)[0];
    const feed = { title: tagText(head, 'title'), link: attr(head, 'link', 'href', a => !/rel\s*=\s*["']self/i.test(a)), items: [] };
    for (const e of blocks(text, 'entry')) {
      const link = attr(e, 'link', 'href', a => !/rel\s*=\s*["'](?!alternate)/i.test(a)) || attr(e, 'link', 'href');
      const videoId = tagText(e, 'yt:videoId');
      feed.items.push({
        id: tagText(e, 'id') || link,
        title: tagText(e, 'title'),
        link,
        date: toDate(tagText(e, 'published') || tagText(e, 'updated')),
        author: tagText(tagText(e, 'author'), 'name'),
        summary: stripHtml(tagText(e, 'media:description') || tagText(e, 'summary') || tagText(e, 'content')).slice(0, 1000),
        image: attr(e, 'media:thumbnail', 'url') || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : ''),
        videoId: videoId || null,
      });
    }
    return feed;
  }
  const channel = blocks(text, 'channel')[0] ?? text;
  const head = channel.split(/<item[\s>]/i)[0];
  const feed = { title: tagText(head, 'title'), link: tagText(head, 'link'), items: [] };
  for (const it of blocks(channel, 'item')) {
    const link = tagText(it, 'link');
    const desc = tagText(it, 'description') || tagText(it, 'content:encoded');
    const img = attr(it, 'media:content', 'url') || attr(it, 'media:thumbnail', 'url') || attr(it, 'enclosure', 'url', a => /type\s*=\s*["']image/i.test(a))
      || (/<img[^>]+src=["']([^"']+)/i.exec(desc)?.[1] ?? '');
    feed.items.push({
      id: tagText(it, 'guid') || link || tagText(it, 'title'),
      title: tagText(it, 'title'),
      link,
      date: toDate(tagText(it, 'pubDate') || tagText(it, 'dc:date')),
      author: tagText(it, 'dc:creator') || tagText(it, 'author'),
      summary: stripHtml(desc).slice(0, 1000),
      image: decodeEntities(img),
      videoId: null,
    });
  }
  return feed;
}
