import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // `.claude/skills/**` holds bundled Claude Code skill deliverables (run by Node
  // directly, not part of the TS source graph) — out of scope for repo linting.
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
