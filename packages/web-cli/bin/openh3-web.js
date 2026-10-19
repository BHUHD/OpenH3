#!/usr/bin/env node
import('../src/index.js').catch((err) => {
  console.error('Failed to start openh3-web:', err);
  process.exit(1);
});
