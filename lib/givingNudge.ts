import type { SharedRef } from './chatService';

/**
 * Giving is part of the life of this church, so members are free to encourage
 * one another to sow a seed, tithe and give an offering. What must never
 * happen is money going to a person instead of the ministry — the database
 * filter holds "Venmo me", "Cash App me" and the like.
 *
 * So when a message talks about giving, the chat offers to attach the
 * church's own Give card. It opens the Give tab inside the app, where every
 * gift goes to the ministry's own Stripe account.
 */
const GIVING_WORDS = /\b(sow|sowing|sown|seeds?|tithes?|tithing|offerings?|give|giving|gifts?|donat(e|es|ed|ing|ion|ions)|partner(ing)?|first\s*fruits?)\b/i;

export function mentionsGiving(text: string): boolean {
  return GIVING_WORDS.test(text.normalize('NFKC'));
}

/** The card a message carries when the Give link is attached. No url on purpose:
 *  an older build that does not know kind 'give' then has nothing to open. */
export const GIVE_SHARED: SharedRef = {
  kind: 'give',
  title: 'Sow a seed, tithe or give an offering',
  speaker: 'Overcomers Global Network',
};
