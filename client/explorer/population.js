export const POPULATION_BANDS=Object.freeze([{max:1000000,areas:5},{max:5000000,areas:10},{max:10000000,areas:15},{max:Infinity,areas:20}]);
export function populationTier(population){if(!Number.isFinite(population)||population<0)return 5;return POPULATION_BANDS.find(b=>population<=b.max).areas;}
