import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFeedEnvelope } from '../server/feedEnvelope.mjs';

test('recognizes RSS 2.0 with XML declaration', () => {
  assert.equal(validateFeedEnvelope('<?xml version="1.0"?><rss version="2.0"><channel><item><title>Climate</title></item></channel></rss>'), 'rss');
});

test('recognizes Atom and an empty but valid RSS feed', () => {
  assert.equal(validateFeedEnvelope('<feed xmlns="http://www.w3.org/2005/Atom"><entry></entry></feed>'), 'atom');
  assert.equal(validateFeedEnvelope('<rss><channel></channel></rss>'), 'rss');
});

test('rejects HTML, empty input and broken feed envelopes', () => {
  for (const xml of ['', '<html><body>Oops</body></html>', '<rss><channel></rss>']) {
    assert.throws(() => validateFeedEnvelope(xml), /Empty|envelope/);
  }
});

test('rejects DTD and entity declarations', () => {
  for (const xml of ['<!DOCTYPE rss><rss><channel></channel></rss>', '<rss><channel><!ENTITY x "hi"></channel></rss>']) {
    assert.throws(() => validateFeedEnvelope(xml), /declarations/);
  }
});

test('rejects unbalanced RSS and Atom entry elements', () => {
  for (const xml of ['<rss><channel><item></channel></rss>', '<feed><entry></feed>']) {
    assert.throws(() => validateFeedEnvelope(xml), /Unbalanced/);
  }
});
