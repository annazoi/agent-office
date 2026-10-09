
/*
 * Holiday costumes (see world/holiday.ts for the decorations): the workers go as zombies for
 * Halloween and elves for Christmas, people wear a warlock's hat or a Santa hat, and the dog gets bat
 * wings and a witch's hat, or antlers and a glowing red nose. Each piece is built here and hung on
 * the model that wears it.
 */

export { UNDEAD_SKIN } from './shared';
export { zombieWorker, elfHat, elfWorker, elfBoot } from './workers';
export { GRIME, peasantGarb, beard, beardColor, grime } from './castle';
export type { PeasantGarb, Beard } from './castle';
export { warlockHat, santaHat } from './hats';
export { batWingGeometry, dogBatWings, dogWitchHat, dogAntlers, dogRedNose, dogScarf } from './dog';
export { raggedCuff, warlockHand, glowTexture, witchFire } from './hands';
