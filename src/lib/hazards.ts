// The single place every hazard type is defined. The label is what is stored in
// reports.hazard_type. "Others" requires a free-text description, stored
// separately in reports.hazard_other_text.
export interface HazardDef {
  key: string;
  label: string;
  requiresText?: boolean;
}

export const HAZARDS: HazardDef[] = [
  { key: 'flood', label: 'Flood' },
  { key: 'river_overflow', label: 'River Overflow' },
  { key: 'drainage_blockage', label: 'Drainage Blockage' },
  { key: 'storm_surge', label: 'Storm Surge' },
  { key: 'coastal_erosion', label: 'Coastal Erosion' },
  { key: 'strong_wind', label: 'Strong Wind / Typhoon Damage' },
  { key: 'fallen_tree', label: 'Fallen Tree' },
  { key: 'landslide', label: 'Landslide / Soil Erosion' },
  { key: 'earthquake', label: 'Earthquake' },
  { key: 'road_damage', label: 'Road Damage' },
  { key: 'vehicular_accident', label: 'Vehicular Accident' },
  { key: 'fire', label: 'Fire' },
  { key: 'power_line', label: 'Electrical / Power Line Hazard' },
  { key: 'other', label: 'Others', requiresText: true },
];

export const OTHER_HAZARD = HAZARDS[HAZARDS.length - 1];
export const HAZARD_LABELS = HAZARDS.map((h) => h.label);
// Guides are organised by every known hazard plus a generic "General" bucket.
export const GUIDE_HAZARDS = HAZARDS.filter((h) => h.key !== 'other').map((h) => h.label).concat(['General']);

const BY_KEY: Record<string, HazardDef> = {};
const BY_LABEL: Record<string, HazardDef> = {};
HAZARDS.forEach((h) => {
  BY_KEY[h.key] = h;
  BY_LABEL[h.label.toLowerCase()] = h;
});

// Resolves a stored key or label; anything unrecognised is treated as "Others".
export function classifyHazard(text: string | null | undefined): HazardDef {
  const raw = String(text || '').trim();
  if (!raw) return OTHER_HAZARD;
  return BY_KEY[raw] || BY_LABEL[raw.toLowerCase()] || OTHER_HAZARD;
}

export const isOtherHazard = (text: string | null | undefined) => classifyHazard(text).key === 'other';

export function hazardDisplayLabel(text: string | null | undefined, otherText?: string | null): string {
  const h = classifyHazard(text);
  if (h.key === 'other' && otherText && otherText.trim()) return `${h.label}: ${otherText.trim()}`;
  return h.label;
}

// The teams that usually answer each hazard, best first. The dispatch form
// lists these first and marks them "(Suggested)"; every team stays pickable.
const SUGGESTED_TEAMS: Record<string, string[]> = {
  flood: ['Barangay Response Team', 'Rescue Unit'],
  river_overflow: ['Barangay Response Team', 'Rescue Unit'],
  drainage_blockage: ['Barangay Response Team', 'Rescue Unit'],
  storm_surge: ['Barangay Response Team', 'Rescue Unit'],
  coastal_erosion: ['Barangay Response Team', 'Rescue Unit'],
  strong_wind: ['Barangay Response Team'],
  fallen_tree: ['Barangay Response Team'],
  landslide: ['Rescue Unit', 'Ambulance', 'Barangay Response Team'],
  earthquake: ['Rescue Unit', 'Ambulance', 'Barangay Response Team'],
  road_damage: ['PNP', 'Barangay Response Team'],
  vehicular_accident: ['PNP', 'Ambulance'],
  fire: ['BFP', 'Barangay Response Team'],
  power_line: ['BFP', 'Barangay Response Team'],
};

export function suggestedTeams(hazard: string | null | undefined): string[] {
  return (SUGGESTED_TEAMS[classifyHazard(hazard).key] || []).slice();
}
