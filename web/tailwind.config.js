/** Colors are CSS variables (RGB triplets) so themes can change them live. */
const c = (v) => `rgb(var(--c-${v}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'), surface: c('surface'), 'surface-2': c('surface-2'), card: c('card'), border: c('border'),
        fg: c('text'), muted: c('muted'), primary: c('primary'), 'on-primary': c('on-primary'), secondary: c('secondary'),
        accent: c('accent'), hover: c('hover'), selected: c('selected'), danger: c('danger'), success: c('success'), warning: c('warning'),
      },
      borderRadius: { DEFAULT: 'var(--radius)', lg: 'calc(var(--radius) * 1.5)', xl: 'calc(var(--radius) * 2)', sm: 'calc(var(--radius) * .6)' },
      fontFamily: { sans: 'var(--font-sans)', serif: 'var(--font-serif)', display: 'var(--font-display)' },
      boxShadow: { card: '0 1px 2px rgb(0 0 0 / calc(var(--shadow) * .25)), 0 8px 24px rgb(0 0 0 / calc(var(--shadow) * .18))' },
      transitionDuration: { DEFAULT: 'var(--anim)' },
    },
  },
  plugins: [],
};
