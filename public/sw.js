/* No offline page cache: private dashboard data must never be cached by this worker. */
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (!payload || typeof payload.eventId !== 'string' || typeof payload.userId !== 'string') return;
    // A device may have changed accounts since the provider queued this message.
    // Fail closed when signed out, offline, or signed in to a different account.
    try {
      const response = await fetch('/api/session', { headers: { 'X-Pinged-Client': '1' }, credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok || (await response.json()).user?.id !== payload.userId) return;
    } catch { return; }
    await self.registration.showNotification('Pinged', {
      body: 'New discoveries are waiting in your inbox.',
      tag: payload.eventId,
      data: { url: '/#inbox' }
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL('/#inbox', self.location.origin).href;
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if (new URL(client.url).origin === self.location.origin) { await client.navigate(url); await client.focus(); return; }
    }
    await self.clients.openWindow(url);
  })());
});
