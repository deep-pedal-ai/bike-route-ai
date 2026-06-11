export type Difficulty = 'Easy' | 'Moderate' | 'Hard' | 'Epic';

export interface Surface {
  label: string;
  percentage: number;
}

export interface TurnStep {
  miles: string;
  instruction: string;
  note?: string;
}

export interface RouteData {
  id: string;
  name: string;
  tagline: string;
  distanceMiles: number;
  elevationFt: number;
  estimatedTime: string;
  difficulty: Difficulty;
  surfaces: Surface[];
  overview: string;
  highlights: string[];
  turns: TurnStep[];
  gearTips: string[];
}
