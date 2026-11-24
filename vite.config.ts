import { defineConfig } from 'vitest/config'

export default defineConfig({
  // GitHub Pages 子路徑 —— 同 repo 名一字不差
  base: '/lammpdagent-dashboard/',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
