export const supportsPush = () => typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export async function enableBrowserPush(publicKey) {
  if (!supportsPush()) throw new Error('This browser does not support push here. Use silent Pings instead.');
  // Permission is requested only from an explicit user click.
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked or permission was not granted. You can keep using silent Pings.');
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), value => value.charCodeAt(0));
  if (subscription && String(new Uint8Array(subscription.options.applicationServerKey || [])) !== String(bytes)) { await subscription.unsubscribe(); subscription = null; }
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  return subscription.toJSON();
}
export async function disconnectBrowserPush() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
}
