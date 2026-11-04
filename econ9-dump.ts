import { craftAffixesForRelic, ALL_CRAFT_RECIPES } from './src/content/crafting.js';
for (const n of ['Precision Calipers', 'Servo Bench Rig', 'Reclaimer Head', 'Prime Laboratory']) {
  console.log(n + ' => ' + JSON.stringify(craftAffixesForRelic(n)));
}
console.log('RECIPES:' + ALL_CRAFT_RECIPES.length);
console.log('IDS:' + ALL_CRAFT_RECIPES.map(r => r.id).join(','));
