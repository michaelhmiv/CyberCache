/**
 * Stage rise schedule (Stage Iteration R2).
 *
 * The stage rises used to cut at 0.95–1.6 s — on device the drops
 * "weren't showing up" (owner report, 2026-11-12). The fix keeps
 * the rise MOTION at its Sample-B law length and adds a readable
 * hold + fade around it, shared by every stage rise through
 * StageRise + lootRiseTotalMs. These tests pin the schedule's
 * arithmetic and the chip's ground-anchored geometry.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MOVEMENT, lootRiseTotalMs } from '@/lib/pixel/movement';
import { StageRise } from '@/components/pixelArt/StageRise';

describe('the shared rise schedule', () => {
  it('rise motion keeps its law length; the total adds hold + fade', () => {
    expect(MOVEMENT.LOOT_RISE_MS).toBe(950);
    expect(lootRiseTotalMs()).toBe(
      MOVEMENT.LOOT_RISE_MS + MOVEMENT.LOOT_RISE_HOLD_MS + MOVEMENT.LOOT_RISE_FADE_MS,
    );
    // The readable window (rise + hold) clears the brief's 2.5 s floor.
    expect(MOVEMENT.LOOT_RISE_MS + MOVEMENT.LOOT_RISE_HOLD_MS).toBeGreaterThanOrEqual(2500);
    expect(MOVEMENT.LOOT_LIGHT_LINGER_MS).toBeGreaterThanOrEqual(2500);
  });
});

describe('StageRise', () => {
  it('anchors the chip box BOTTOM on the origin point and carries its bookkeeping attrs', () => {
    render(
      <StageRise testId="rise" dataAttrs={{ 'loot-visual': 'material' }} xPct={66} yPct={86}>
        <span>chip</span>
      </StageRise>,
    );
    const el = screen.getByTestId('rise');
    expect(el.textContent).toContain('chip');
    expect(el.getAttribute('data-loot-visual')).toBe('material');
    expect(el.style.left).toBe('66%');
    expect(el.style.top).toBe('86%');
    // Default box 46×58: centered on the origin horizontally, and
    // the box's bottom edge sits ON the origin (the corpse's feet).
    expect(el.style.marginLeft).toBe('-23px');
    expect(el.style.marginTop).toBe('-58px');
  });
});
