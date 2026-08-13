import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: ['es2019', 'safari13.1', 'ios13.4']
  }
});
