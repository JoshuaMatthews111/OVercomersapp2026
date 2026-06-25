export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const lower = message.toLowerCase();

  if (!message) return fallback;
  if (lower.includes('jwt') || lower.includes('auth') || lower.includes('sign in')) return 'Please sign in and try again.';
  if (lower.includes('permission') || lower.includes('policy') || lower.includes('rls') || lower.includes('row-level')) return 'Your account does not have permission for this action yet.';
  if (lower.includes('bucket') || lower.includes('storage')) return 'File storage is not ready for this upload yet. Please check the app storage setup.';
  if (lower.includes('network') || lower.includes('fetch')) return 'Network connection failed. Please check your connection and try again.';
  if (lower.includes('duplicate')) return 'This item is already saved.';
  if (lower.includes('not configured')) return message;

  return fallback;
}
