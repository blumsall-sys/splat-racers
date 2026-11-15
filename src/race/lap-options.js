/** Race-only lap target, independent of Blender track authoring. */
export const LAP_CHOICES=Object.freeze([1,3,5]);
export const DEFAULT_LAPS=3;
export function selectLapTarget(value){
 const n=Number(value);
 if(!LAP_CHOICES.includes(n))throw new Error('Race length must be 1, 3, or 5 laps');
 return n;
}
export function configuredRaceTarget(selectValue){
 return selectLapTarget(selectValue ?? DEFAULT_LAPS);
}
