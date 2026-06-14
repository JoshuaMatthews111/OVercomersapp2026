export const colors = {
  royalBlue: '#0B1D4D',
  deepBlue: '#071B45',
  brightBlue: '#123A8F',
  gold: '#D4AF37',
  softGold: '#F7E3A0',
  cream: '#F7F3E6',
  white: '#FFFFFF',
  slate: '#4B5563',
  line: '#E5E7EB',
  green: '#1F9D55',
  amber: '#D99A10',
  red: '#B42318',
  purple: '#6941C6'
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 14, lg: 20, pill: 999 };
export const typography = {
  heading: { fontWeight: '700' as const, color: colors.royalBlue },
  body: { fontWeight: '400' as const, color: '#111827' },
  serifNote: { color: colors.gold }
};
