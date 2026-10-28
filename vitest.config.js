import {defineConfig} from 'vitest/config';

// Node protocol/Worker tests use node:test and are run by their own scripts.
export default defineConfig({
  test:{
    include:['tests/vitest/**/*.test.ts'],
    setupFiles:['./tests/vitest/setup.ts'],
    environment:'jsdom',
    coverage:{provider:'istanbul',reportsDirectory:'coverage',reporter:['text-summary','html']},
  },
  esbuild:{keepNames:true},
});
