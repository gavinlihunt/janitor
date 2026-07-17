import { useSyncExternalStore } from 'react';

/**
 * Minimal hash-based router. Hash routing needs no server rewrite rules and no
 * external dependency, and the browser Back button works for free because each
 * hash change is a history entry. Routes:
 *   (empty)            -> dashboard (landing page)
 *   #/resources        -> resource group listing
 *   #/group/<name>     -> resource group detail (opens over the resources page)
 */
export type Route =
  | { name: 'dashboard' }
  | { name: 'resources' }
  | { name: 'group'; group: string };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const match = path.match(/^\/group\/(.+)$/);
  if (match) return { name: 'group', group: decodeURIComponent(match[1]) };
  if (path === '/resources') return { name: 'resources' };
  return { name: 'dashboard' };
}

function toHash(route: Route): string {
  switch (route.name) {
    case 'group':
      return `#/group/${encodeURIComponent(route.group)}`;
    case 'resources':
      return '#/resources';
    default:
      return '';
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => ''
  );
  return parse(hash);
}

/** Navigate by setting the hash, which pushes a history entry. */
export function navigate(route: Route): void {
  const next = toHash(route);
  if (next) {
    window.location.hash = next;
  } else {
    // Clear the hash without leaving a dangling "#" in the address bar.
    history.pushState('', document.title, window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}
