export type Objective = 'drought-resilience' | 'food-security' | 'farmer-income' | 'water-security';
export type InterventionKind = 'irrigation' | 'protected-agriculture' | 'water-harvesting' | 'climate-smart-crops' | 'extension-support' | 'blended';

export interface SimulationInput { county: string; budgetKes: number; objective: Objective; horizonYears: number; }
export interface SimulationOption {
  kind: InterventionKind; name: string; allocatedKes: number; beneficiaries: number;
  implementationMonths: number; suitability: number; expectedImpact: number;
  evidenceStrength: 'moderate' | 'limited'; risks: string[]; assumptions: string[];
  valueForMoney: number; label: 'SIMULATED BENCHMARK';
}

const profiles: Record<Exclude<InterventionKind, 'blended'>, Omit<SimulationOption, 'kind'|'allocatedKes'|'beneficiaries'|'valueForMoney'|'label'>> = {
  irrigation: {name:'Small-scale drip irrigation', implementationMonths:9, suitability:78, expectedImpact:82, evidenceStrength:'moderate', risks:['Water source reliability','Maintenance capacity'], assumptions:['KES 120,000 benchmark per participating household','Existing or planned water source']},
  'protected-agriculture': {name:'Protected agriculture / greenhouses', implementationMonths:7, suitability:70, expectedImpact:76, evidenceStrength:'limited', risks:['Market access','High operating costs'], assumptions:['KES 350,000 benchmark per production unit','Producer groups share supporting infrastructure']},
  'water-harvesting': {name:'Rainwater harvesting and storage', implementationMonths:6, suitability:86, expectedImpact:79, evidenceStrength:'moderate', risks:['Rainfall timing','Storage maintenance'], assumptions:['KES 80,000 benchmark per household-equivalent package','Community siting completed']},
  'climate-smart-crops': {name:'Climate-smart crop switching', implementationMonths:4, suitability:88, expectedImpact:73, evidenceStrength:'moderate', risks:['Farmer adoption','Seed availability'], assumptions:['KES 24,000 benchmark per farmer package','Extension advice included']},
  'extension-support': {name:'Extension and advisory support', implementationMonths:3, suitability:84, expectedImpact:66, evidenceStrength:'moderate', risks:['Staff capacity','Last-mile engagement'], assumptions:['KES 10,000 benchmark per farmer reached','Digital and field delivery combined']}
};

const unitCost: Record<Exclude<InterventionKind, 'blended'>, number> = {irrigation:120000,'protected-agriculture':350000,'water-harvesting':80000,'climate-smart-crops':24000,'extension-support':10000};
const objectiveBoost: Record<Objective, Partial<Record<InterventionKind, number>>> = {
  'drought-resilience': {'water-harvesting':8, irrigation:6, 'climate-smart-crops':5},
  'food-security': {irrigation:7, 'climate-smart-crops':7, 'protected-agriculture':4},
  'farmer-income': {'protected-agriculture':8, irrigation:4, 'extension-support':4},
  'water-security': {'water-harvesting':10, irrigation:5}
};

export function simulateClimateAction(input: SimulationInput): SimulationOption[] {
  if (!Number.isFinite(input.budgetKes) || input.budgetKes <= 0) throw new Error('Budget must be greater than zero');
  const base: SimulationOption[] = (Object.keys(profiles) as Exclude<InterventionKind,'blended'>[]).map(kind => {
    const profile = profiles[kind];
    const beneficiaries = Math.max(1, Math.floor(input.budgetKes / unitCost[kind]));
    const impact = Math.min(96, profile.expectedImpact + (objectiveBoost[input.objective][kind] ?? 0));
    return {...profile, kind, allocatedKes:input.budgetKes, beneficiaries, expectedImpact:impact,
      valueForMoney: Math.round((beneficiaries * impact / input.budgetKes) * 100000), label:'SIMULATED BENCHMARK' as const};
  });
  const blendedBeneficiaries = Math.floor(input.budgetKes * .45 / unitCost['water-harvesting']) + Math.floor(input.budgetKes * .3 / unitCost['climate-smart-crops']) + Math.floor(input.budgetKes * .25 / unitCost['extension-support']);
  base.push({kind:'blended', name:'Blended resilience portfolio', allocatedKes:input.budgetKes, beneficiaries:blendedBeneficiaries,
    implementationMonths:8, suitability:91, expectedImpact:88, evidenceStrength:'moderate',
    risks:['Coordination across implementing partners','Benchmark overlap may double-count some beneficiaries'],
    assumptions:['45% water harvesting, 30% climate-smart crops, 25% extension','Beneficiaries are household-equivalents and may overlap'],
    valueForMoney:Math.round((blendedBeneficiaries*88/input.budgetKes)*100000), label:'SIMULATED BENCHMARK'});
  return base.sort((a,b) => (b.expectedImpact+b.suitability+b.valueForMoney)-(a.expectedImpact+a.suitability+a.valueForMoney));
}
