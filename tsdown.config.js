import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'core/index': 'src/core/index.ts',
    'cli/index': 'src/cli/main.ts',
    'cli/hook-handler': 'src/cli/hook-handler.ts',
  },
  format: 'esm',
  target: 'node20',
  dts: true,
  clean: true,
  fixedExtension: false,
});
