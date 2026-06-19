import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand structural colors
        'brand-black': '#0a0a0a',
        'brand-white': '#f5f4f0',
        'brand-red': '#d44040',
        'brand-mid': '#6a6864',
        'brand-dim': '#2e2e2c',
        'brand-rule': '#1a1a18',
        'brand-surface': '#111110',
        'brand-surface2': '#161614',
        // Foreground text colors (dark surfaces)
        'fg-primary': '#f5f4f0',
        'fg-secondary': '#aaa8a4',
        'fg-tertiary': '#888680',
        'fg-faint': '#6a6864',
        // Foreground text colors (light surfaces)
        'fg-inv-primary': '#0a0a0a',
        'fg-inv-secondary': '#4c4a47',
        'fg-inv-tertiary': '#636160',
        'fg-inv-faint': '#83817b',
        // Interactive states
        interactive: '#d44040',
        'surface-hover': '#111110',
        'surface-active': '#161614',
      },
      fontFamily: {
        display: ['"IBM Plex Sans Condensed"', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
        serif: ['"IBM Plex Serif"', 'serif'],
      },
      fontWeight: {
        regular: '400',
        medium: '500',
        bold: '700',
      },
      letterSpacing: {
        wordmark: '-0.04em',
        display: '-0.03em',
        heading: '-0.02em',
        body: '0em',
        label: '0.14em',
        'label-wide': '0.18em',
        'label-xl': '0.22em',
        micro: '0.1em',
      },
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '20px',
        6: '24px',
        8: '32px',
        10: '40px',
        12: '48px',
        16: '64px',
        20: '80px',
      },
      borderRadius: {
        sm: '3px',
        md: '5px',
        lg: '8px',
        xl: '12px',
      },
      borderWidth: {
        hairline: '0.5px',
        thin: '1px',
        bar: '3px',
        mark: '4px',
      },
      lineHeight: {
        tight: '1.05',
        snug: '1.3',
        normal: '1.6',
        relaxed: '1.8',
        editorial: '2',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '200ms',
      },
    },
  },
  plugins: [],
};

export default config;
