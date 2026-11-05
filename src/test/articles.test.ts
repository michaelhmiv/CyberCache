import { describe, expect, it } from 'vitest';
import { articleFor, withArticle } from '@/lib/utils/articles';
import { MANUFACTURERS } from '@/constants/manufacturers';

/**
 * Papercut (typo class): copy interpolating a manufacturer name used
 * to hardcode the article "a", printing "a Ironwood weapon" wherever
 * a name was slotted in. The helper agrees the article with the name;
 * these pins cover every live manufacturer so a future vowel-initial
 * maker can't reintroduce the class.
 */
describe('withArticle — indefinite-article agreement', () => {
  it('uses "an" before vowel-initial names and "a" otherwise', () => {
    expect(withArticle('Ironwood')).toBe('an Ironwood');
    expect(withArticle('Redline')).toBe('a Redline');
    expect(articleFor('HelixWorks')).toBe('a');
    expect(articleFor('ironwood')).toBe('an'); // case-insensitive
  });

  it('capitalizes for sentence-initial use', () => {
    expect(withArticle('Ironwood', true)).toBe('An Ironwood');
    expect(withArticle('Redline', true)).toBe('A Redline');
  });

  it('agrees for every manufacturer in the live catalog', () => {
    for (const def of Object.values(MANUFACTURERS)) {
      const expected = /^[aeiou]/i.test(def.name) ? 'an' : 'a';
      expect(articleFor(def.name), def.name).toBe(expected);
      expect(withArticle(def.name)).toBe(`${expected} ${def.name}`);
    }
  });
});
