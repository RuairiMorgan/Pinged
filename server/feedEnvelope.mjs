// Conservative RSS 2.0 / Atom envelope checks. Not a full XML parser.
export function validateFeedEnvelope(xml) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('Empty feed XML');
  const body = xml.replace(/^\uFEFF/, '').replace(/^\s*<\?xml\s+[^?]*\?>/i, '').trim();
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(body)) throw new Error('Feed XML declarations are not supported');
  const rss = /^<rss(?:\s[^>]*)?>[\s\S]*<\/rss\s*>$/i.test(body) &&
    /<channel(?:\s[^>]*)?>[\s\S]*<\/channel\s*>/i.test(body);
  const atom = /^<feed(?:\s[^>]*)?>[\s\S]*<\/feed\s*>$/i.test(body);
  if (!rss && !atom) throw new Error('Unsupported or malformed RSS/Atom envelope');
  const element = rss ? 'item' : 'entry';
  const opened = (body.match(new RegExp('<' + element + '(?=[\\s>])[^>]*>', 'gi')) || []).length;
  const closed = (body.match(new RegExp('<\\/' + element + '\\s*>', 'gi')) || []).length;
  if (opened !== closed) throw new Error('Unbalanced feed entry elements');
  return rss ? 'rss' : 'atom';
}
