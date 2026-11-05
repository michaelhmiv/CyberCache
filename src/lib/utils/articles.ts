/**
 * Indefinite-article agreement for copy that interpolates a display
 * name ("a Redline weapon" / "an Ironwood weapon"). Player-facing
 * strings used to hardcode "a" before manufacturer names, which read
 * wrong for every vowel-initial name (Ironwood is the live case).
 * One helper so the class can't creep back site by site.
 */
export function articleFor(name: string): 'a' | 'an' {
  return /^[aeiou]/i.test(name.trim()) ? 'an' : 'a';
}

/** "a Redline" / "an Ironwood" — the article agreed with the name. */
export function withArticle(name: string, capitalize = false): string {
  const article = articleFor(name);
  return `${capitalize ? article.toUpperCase() : article} ${name}`;
}
