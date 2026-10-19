import { describe, it, expect } from 'vitest';
import { formatAgeRange, formatTargetAgeRange, groupAgeLabel } from '../utils/ageRange';

// Marie, 11.10.2026: target 23–33 set, the group page said „bis 27" — it
// showed the members' actual span. The owner's range leads now.
describe('groupAgeLabel', () => {
  it('shows the owner\'s target range, not the members\' span', () => {
    expect(groupAgeLabel({ target_age_min: 23, target_age_max: 33, age_min: 23, age_max: 27 })).toBe('23-33');
  });

  it('falls back to the members\' span when no range was set', () => {
    expect(groupAgeLabel({ target_age_min: null, target_age_max: null, age_min: 24, age_max: 29 })).toBe('24-29');
    expect(groupAgeLabel({ age_min: 26, age_max: 26 })).toBe('26');
  });

  it('handles a range open on one side', () => {
    expect(groupAgeLabel({ target_age_min: 25, target_age_max: null })).toBe('25+');
    expect(groupAgeLabel({ target_age_min: null, target_age_max: 30 })).toBe('18-30');
  });

  it('shows nothing without any age information', () => {
    expect(groupAgeLabel({})).toBeNull();
    expect(groupAgeLabel(null)).toBeNull();
  });
});

describe('formatAgeRange / formatTargetAgeRange', () => {
  it('keeps the 18+ floor and the 60+ cap', () => {
    expect(formatAgeRange(16, 30)).toBe('18-30');
    expect(formatAgeRange(40, 75)).toBe('40-60+');
    expect(formatTargetAgeRange(65, null)).toBe('60+');
    expect(formatTargetAgeRange(14, null)).toBe('18+');
  });
});
