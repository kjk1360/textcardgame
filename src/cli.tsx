#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.js';

/**
 * Entry point. Exposed as `crtgame` bin in package.json.
 *
 * `npm install -g textcrawlergame` then `crtgame` to run.
 * For local dev: `npm run dev`.
 */

render(<App />);
