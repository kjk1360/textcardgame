import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * FocusList — keyboard-navigable list of options.
 *
 * Standard input model:
 *   ↑/↓ : move focus
 *   Enter : confirm focused item → onSelect(item, index)
 *   1-9 : jump-select — focus item at that 1-based index AND confirm
 *          (only fires for enabled items; out-of-range / disabled = no-op)
 *   Esc : optional onCancel
 *
 * Disabled items are skipped during navigation. If an item provides
 * `disabledReason`, it's shown next to the label in gray.
 *
 * Use `onFocusChange` to drive the right-side detail panel.
 *
 * The item index shown to the user (the "1" in "1. 카드") is the
 * 1-based position in `items`, including disabled rows. Disabled rows
 * can't be jump-selected but still occupy a slot.
 */

export interface FocusListItem<T = unknown> {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly value: T;
  /**
   * Optional per-item color (Ink color name or hex). Used for graded
   * items so card/skill rarity is visible at a glance. Ignored when
   * the row is focused (focus uses the active-yellow highlight) or
   * disabled (gray).
   */
  readonly color?: string;
}

export interface FocusListProps<T> {
  items: ReadonlyArray<FocusListItem<T>>;
  isActive?: boolean;            // when false, ignore input
  onSelect?: (item: FocusListItem<T>, index: number) => void;
  onCancel?: () => void;
  onFocusChange?: (item: FocusListItem<T> | null, index: number) => void;
  /** When true, also report focus on mount even if items already focused. */
  emitInitialFocus?: boolean;
  /** Optional label prefix for the cursor row (default '▸ '). */
  cursor?: string;
  /** Inactive prefix (default '  '). */
  noncursor?: string;
}

export function FocusList<T>({
  items,
  isActive = true,
  onSelect,
  onCancel,
  onFocusChange,
  emitInitialFocus = true,
  cursor = '▸ ',
  noncursor = '  ',
}: FocusListProps<T>): React.ReactElement {
  const firstEnabled = items.findIndex(i => !i.disabled);
  const [focused, setFocused] = useState(firstEnabled === -1 ? 0 : firstEnabled);

  // Keep focus inside valid range as items change
  useEffect(() => {
    if (items.length === 0) return;
    if (focused >= items.length) {
      setFocused(items.length - 1);
    }
  }, [items.length, focused]);

  // Emit initial focus
  useEffect(() => {
    if (!emitInitialFocus) return;
    onFocusChange?.(items[focused] ?? null, focused);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput((input, key) => {
    if (!isActive || items.length === 0) return;
    if (key.upArrow) {
      moveFocus(-1);
    } else if (key.downArrow) {
      moveFocus(1);
    } else if (key.return) {
      const item = items[focused];
      if (item && !item.disabled) {
        onSelect?.(item, focused);
      }
    } else if (key.escape) {
      onCancel?.();
    } else if (/^[1-9]$/.test(input)) {
      // Jump-select by 1-based index. Focus the item AND confirm
      // immediately, as if the user pressed ↓×N then Enter.
      const idx = Number(input) - 1;
      if (idx < items.length) {
        const item = items[idx];
        if (item && !item.disabled) {
          if (idx !== focused) {
            setFocused(idx);
            onFocusChange?.(item, idx);
          }
          onSelect?.(item, idx);
        }
      }
    }
  });

  function moveFocus(dir: -1 | 1): void {
    let next = focused;
    for (let i = 0; i < items.length; i++) {
      next = (next + dir + items.length) % items.length;
      if (!items[next]?.disabled) break;
    }
    if (next !== focused) {
      setFocused(next);
      onFocusChange?.(items[next] ?? null, next);
    }
  }

  return (
    <Box flexDirection="column">
      {items.length === 0 ? (
        <Text dimColor>(no options)</Text>
      ) : (
        items.map((item, i) => {
          const isFocused = i === focused;
          const isDisabled = !!item.disabled;
          // 1-based numeric shortcut hint. Only show 1-9; beyond that
          // we hide the digit (jump-select still won't fire for those).
          const numHint = i < 9 ? `${i + 1}. ` : '   ';
          // Color precedence: disabled gray > focused yellow > item.color > default
          const color = isDisabled
            ? 'gray'
            : isFocused
              ? 'yellow'
              : item.color;
          return (
            <Box key={item.id}>
              <Text
                color={color}
                bold={isFocused && !isDisabled}
              >
                {isFocused ? cursor : noncursor}
                {numHint}
                {item.label}
                {isDisabled && item.disabledReason ? ` (${item.disabledReason})` : ''}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
