// Econ 9 scratch generator (not shipped): serialize the TS craft
// catalog exactly as the SQL catalog literal carries it.
import { ALL_CRAFT_RECIPES } from './src/content/crafting.js';
import { writeFileSync } from 'node:fs';
const clean = ALL_CRAFT_RECIPES.map((r) => JSON.parse(JSON.stringify(r)) as unknown);
writeFileSync(process.argv[2] as string, JSON.stringify(clean, null, 2) + '\n');
console.log('recipes:', clean.length);
