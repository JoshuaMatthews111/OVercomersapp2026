export const colors = {
  royalBlue: '#0B1D4D',
  deepBlue: '#071B45',
  brightBlue: '#123A8F',
  actionBlue: '#004AAD',
  navyGradientTop: '#0A1A3F',
  navyGradientBottom: '#071231',
  gold: '#D4AF37',
  deepGold: '#A26B00',
  softGold: '#F7E3A0',
  paleGold: '#FFF7E2',
  cream: '#F7F3E6',
  lightBg: '#F8FAFD',
  pearl: '#FCFBF8',
  white: '#FFFFFF',
  slate: '#4B5563',
  muted: '#667085',
  textBody: '#111827',
  line: '#E5E7EB',
  softLine: '#EEF2F6',
  green: '#1F9D55',
  softGreen: '#EAF8EF',
  amber: '#D99A10',
  softAmber: '#FFF6DB',
  red: '#B42318',
  softRed: '#FDECEC',
  purple: '#6941C6',
  softPurple: '#F1EAFE',
  liveRed: '#E11D48',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };
export const typography = {
  heading: { fontWeight: '700' as const, color: colors.royalBlue },
  body: { fontWeight: '400' as const, color: colors.textBody },
  serifNote: { color: colors.gold }
};

export const shadows = {
  soft: {
    shadowColor: colors.royalBlue,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4
  },
  lift: {
    shadowColor: colors.royalBlue,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6
  }
};
