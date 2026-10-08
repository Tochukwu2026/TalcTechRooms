// Matches the gold-on-dark palette of the founder-supplied TalcTech Rooms logo/app icon (see
// spec/decisions-and-phasing.md > Branding) - gold as the primary accent, not a generic blue.
export const colors = {
  gold: '#C9A227',
  goldDark: '#8A6D1A',
  background: '#FFFFFF',
  surface: '#F7F5F0',
  text: '#1A1A1A',
  textMuted: '#6B6B6B',
  border: '#E3E0D8',
  danger: '#C0392B',
  success: '#1E7A46',
};

// Sky Blue theme - founder chose this for the Customer homepage on 2026-10-08 (picked from the
// colour mock-ups). Applied only where a screen opts in; every other screen still uses `colors`.
export const skyBlueTheme = {
  accent: '#0EA5E9',
  accentDark: '#0369A1',
  background: '#F7FCFF',
  surface: '#EAF6FD',
  border: '#BFE3F6',
};
