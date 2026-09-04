/**
 * The welcome screen, reachable by name.
 *
 * Both app/index.tsx (welcome) and app/(tabs)/index.tsx (Home) answer to "/",
 * and router.replace('/') after sign-out resolved to Home — so a signed-out
 * phone showed a normal-looking app and only the More tab admitted nobody was
 * signed in. This gives the welcome screen an address of its own.
 */
export { default } from './index';
