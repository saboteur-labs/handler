import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'core/index': 'src/core/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: 'esm',
  target: 'node20',
  dts: true,
  clean: true,
  fixedExtension: false,
});
