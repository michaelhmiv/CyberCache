import React, { useEffect, useState } from 'react';
import { HeatChip, HeatStrip, type HeatSpot } from './HeatField';
import { RESEARCH_COURSES, researchMasteryXpFor } from '@/content/research';

/**
 * HEAT FIELD — research / dispatch (THROWAWAY harness prototype,
 * iter-09). Research has no stage scene in the game (it runs
 * off-stage; the real panel reads settled Chef state and cannot
 * mount without a server), so the heat field seats on the course
 * card itself, built live from the real def
 * (src/content/research.ts): Shop Fundamentals, Fabrication T1,
 * 6 h, 2,500 cr, mastery XP = RESEARCH_MASTERY_XP_PER_HOUR x
 * duration = 60, granted ONCE at completion.
 *
 *   heat intensity = elapsed / duration.
 *
 * The needle of this surface is accrual, so the field warms as
 * the course accrues and flashes full at completion — the only
 * moment anything is granted. The enroll fee never moves (it is
 * destroyed at enroll), so it carries no heat and is shown as a
 * static term only.
 *
 * Drive: window.__setBeat(n): 0 start (0 h) / 1 flow (3.0 h) /
 * 2 done (6 h, XP granted).
 */

const course = RESEARCH_COURSES.find((c) => c.id === 'shop_fundamentals')!;
const masteryXp = researchMasteryXpFor(course);

const BEATS: Record<number, { elapsed: number; done: boolean }> = {
  0: { elapsed: 0, done: false },
  1: { elapsed: 3, done: false },
  2: { elapsed: 6, done: true },
};

export const HeatResearchPage: React.FC = () => {
  const [beat, setBeat] = useState(0);
  const s = BEATS[beat];
  const heat = s.elapsed / course.durationHours;

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (n: number) => setBeat(n in BEATS ? n : 0);
  }, []);

  const spots: HeatSpot[] =
    heat > 0.01 ? [{ id: 'desk', xPct: 50, yPct: 50, peak: heat, radius: 150, bornAt: 0 }] : [];

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <div
        style={{
          background: '#07080B',
          border: '2px solid #232833',
          padding: '14px 14px 12px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 900, color: '#EDEFF4', letterSpacing: '0.01em' }}>{course.name}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 7 }}>
          <HeatChip label="FACULTY" value="Fabrication" />
          <HeatChip label="TIER" value="1" />
          <HeatChip label="DURATION" value={`${course.durationHours} H`} />
          <HeatChip label="FEE" value={`${course.costCredits.toLocaleString('en-US')} CR · AT ENROLL`} />
        </div>
        {/* the heat field: accrual made visible over the card */}
        <div
          style={{
            position: 'relative',
            height: 168,
            marginTop: 12,
            background: '#050608',
            border: '2px solid #1A1E27',
            overflow: 'hidden',
          }}
        >
          {spots.map((sp) => (
            <div
              key={sp.id}
              style={{
                position: 'absolute',
                left: `${sp.xPct}%`,
                top: `${sp.yPct}%`,
                width: 2 * sp.radius * Math.sqrt(Math.max(sp.peak, 0.001)),
                height: 2 * sp.radius * Math.sqrt(Math.max(sp.peak, 0.001)),
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                background:
                  'radial-gradient(circle, rgba(255,196,96,0.92) 0%, rgba(255,122,26,0.55) 38%, rgba(255,90,20,0) 70%)',
                opacity: 0.22 + 0.78 * sp.peak,
              }}
            />
          ))}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 8,
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.08em',
              color: '#8A93A3',
            }}
          >
            {s.done ? 'COMPLETE' : s.elapsed > 0 ? 'STUDYING' : 'ENROLLED'}
          </div>
        </div>
      </div>
      <HeatStrip intensity={heat} scaleLabel={`FULL = ${course.durationHours} H`}>
        <HeatChip label="ELAPSED" value={`${s.elapsed.toFixed(1)} H`} hot={s.done} />
        <HeatChip label="REMAINING" value={`${(course.durationHours - s.elapsed).toFixed(1)} H`} />
        {s.done ? (
          <HeatChip label="MASTERY XP" value={`${masteryXp} GRANTED`} hot />
        ) : (
          <HeatChip label="MASTERY XP" value={`${masteryXp} AT COMPLETION`} />
        )}
      </HeatStrip>
    </div>
  );
};
