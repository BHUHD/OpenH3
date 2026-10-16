#!/usr/bin/env node
// Adapted from api2img (MIT, Copyright 2026 Voler); see ../LICENSE.
// OpenH3 imports the whole directory; this entrypoint only runs the bundled CLI.
const { main } = require('../core/cli');
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error.message);
    process.exitCode = 1;
  }
);
