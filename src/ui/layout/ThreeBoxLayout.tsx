import React from 'react';
import { Box, Text } from 'ink';

/**
 * Three-box layout per design spec:
 *
 *   ┌──────────────────────────┬──────────────────┐
 *   │   MAIN BOX (state view)  │   RIGHT BOX      │
 *   │                          │   (focused detail)│
 *   ├──────────────────────────┤                  │
 *   │   BOTTOM BOX (choices)   │                  │
 *   └──────────────────────────┴──────────────────┘
 *
 * `main` and `bottom` stack vertically on the left; `right` is the
 * full-height column on the right.
 *
 * Sizes are flex-based — terminal-aware. We use fixed minimums to keep
 * the right panel readable on narrow windows.
 */

export interface ThreeBoxLayoutProps {
  title?: string;
  main: React.ReactNode;
  bottom?: React.ReactNode;
  right?: React.ReactNode;
}

export function ThreeBoxLayout({
  title,
  main,
  bottom,
  right,
}: ThreeBoxLayoutProps): React.ReactElement {
  return (
    <Box flexDirection="column" width="100%">
      {title && (
        <Box paddingX={1}>
          <Text bold color="cyan">
            {title}
          </Text>
        </Box>
      )}
      <Box flexDirection="row" flexGrow={1}>
        {/* Left column: main + bottom (main width +20%, height +20%) */}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={48}>
          <Box
            flexDirection="column"
            flexGrow={1}
            flexShrink={1}
            borderStyle="round"
            paddingX={1}
            paddingY={0}
            minHeight={40}
          >
            {main}
          </Box>
          {bottom !== undefined && (
            <Box
              flexDirection="column"
              borderStyle="round"
              paddingX={1}
              minHeight={5}
            >
              {bottom}
            </Box>
          )}
        </Box>
        {/* Right column: full-height detail */}
        {right !== undefined && (
          <Box
            flexDirection="column"
            borderStyle="round"
            paddingX={1}
            width={36}
            minHeight={40}
          >
            {right}
          </Box>
        )}
      </Box>
    </Box>
  );
}
