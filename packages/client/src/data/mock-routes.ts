import type { RouteData } from '../types/route';

export const GRAVEL_ROUTE: RouteData = {
  id: 'coffee-crunch',
  name: 'The Coffee & Crunch Loop',
  tagline: 'Fire roads, trail connectors, and a mandatory espresso at Mile 12',
  distanceMiles: 22,
  elevationFt: 1200,
  estimatedTime: '2h 15m',
  difficulty: 'Moderate',
  surfaces: [
    { label: 'Gravel', percentage: 70 },
    { label: 'Road', percentage: 30 },
  ],
  overview:
    'A classic mixed-surface adventure that weaves through local fire roads and forest trail connectors before dropping you onto quiet country lanes. Expect loose gravel on the climb sections and hard-packed dirt on the descents. The crown jewel is the mandatory espresso stop at Mile 12 — Ridgeline Roasters, where the barista knows cyclists by name.',
  highlights: [
    'Technical singletrack connector at Mile 4.5 (optional bypass available)',
    'Panoramic ridge views at the summit turnaround (Mile 9)',
    'Espresso + pastry refuel at Ridgeline Roasters (Mile 12)',
    'Fast fire-road descent back to the trailhead (Miles 15–20)',
  ],
  turns: [
    { miles: '0.0', instruction: 'Head north on Trailhead Rd', note: 'Slight climb from the parking lot' },
    { miles: '2.3', instruction: 'Turn left onto Fire Road 14', note: 'Gate is usually open on weekends' },
    { miles: '4.5', instruction: 'Take singletrack connector — right fork', note: 'Optional bypass goes straight' },
    { miles: '9.1', instruction: 'Summit viewpoint — take a breath', note: 'Photo stop recommended' },
    { miles: '12.0', instruction: 'Roll into Ridgeline Roasters', note: 'Lock bikes on the left side' },
    { miles: '20.4', instruction: 'Re-join Trailhead Rd heading south', note: 'Watch for loose gravel at the bottom' },
    { miles: '22.0', instruction: 'Return to start — well earned' },
  ],
  gearTips: [
    'Gravel tires 38c or wider recommended — 40–45c ideal for fire road sections',
    'Bring a tubeless plug kit; flint on the lower fire road is sharp',
    'Pack a light wind layer for the ridge — exposed and gusty above Mile 8',
    'Flat pedals work fine; clipless adds efficiency on the longer climbs',
  ],
};

export const ROAD_ROUTE: RouteData = {
  id: 'coastal-roller',
  name: 'The Coastal Roller Coaster',
  tagline: 'Rolling coastal climbs, sweeping ocean views, and a fast paved descent',
  distanceMiles: 45,
  elevationFt: 2800,
  estimatedTime: '3h 30m',
  difficulty: 'Hard',
  surfaces: [{ label: 'Road', percentage: 100 }],
  overview:
    'An endurance classic for road cyclists seeking sustained effort and big views. The route hugs the coastline for the first 20 miles, rolling through open headlands before climbing inland to the ridge. The back half is a sustained false-flat followed by the signature 4-mile paved descent back to the coast — a reward you will earn.',
  highlights: [
    'Clifftop switchbacks with ocean panoramas (Miles 8–14)',
    'King of the Mountain segment: 3.2-mile sustained 6% grade (Mile 22)',
    'Ridge café at Mile 28 for a mid-ride calorie stop',
    'The Descent: 4 miles of smooth pavement, 1,100 ft drop (Miles 35–39)',
  ],
  turns: [
    { miles: '0.0', instruction: 'Head west on Coast Highway', note: 'Early morning avoids traffic' },
    { miles: '8.2', instruction: 'Bear left onto Headland Loop Rd', note: 'Cliff edge — stay right on descents' },
    { miles: '20.5', instruction: 'Turn right onto Ridge Climb Rd', note: 'KOM segment begins here' },
    { miles: '23.7', instruction: 'Crest the ridge — enjoy the view', note: 'Watch for cross-wind gusts' },
    { miles: '28.1', instruction: 'Stop at The Ridge Café (optional)', note: 'Great espresso, limited seating' },
    { miles: '35.0', instruction: 'Begin the descent on Coastal Drop Rd', note: 'Check brakes before dropping in' },
    { miles: '45.0', instruction: 'Finish back at Coast Highway start' },
  ],
  gearTips: [
    'Road bike with 25–28c tires — pavement is well-maintained throughout',
    'Aero helmet pays off on the exposed headland sections',
    'Carry 2 water bottles minimum; no refill between Miles 14 and 28',
    'Arm warmers recommended — coastal fog burns off slowly on morning rides',
  ],
};

export const CASUAL_ROUTE: RouteData = {
  id: 'greenway-explorer',
  name: 'Greenway Explorer',
  tagline: 'Flat, car-free, and perfect for a leisurely spin on any bike',
  distanceMiles: 12,
  elevationFt: 150,
  estimatedTime: '1h 00m',
  difficulty: 'Easy',
  surfaces: [{ label: 'Paved Path', percentage: 100 }],
  overview:
    'The Greenway Explorer is the antidote to big climbing days. This 12-mile loop follows a dedicated multi-use paved trail through riverside parks, under tree canopy, and past two community gardens — entirely car-free. Perfect for a recovery spin, a first ride on a new bike, or bringing friends who are newer to cycling.',
  highlights: [
    'Riverside section at Mile 2 with benches and water fountains',
    'Wildflower meadow crossing at Mile 5.5 (spring and summer)',
    'Ice cream stand open weekends at Mile 8 — Scoops on the Trail',
    'Final mile through the arboretum — shaded and serene',
  ],
  turns: [
    { miles: '0.0', instruction: 'Start at Greenway South Trailhead', note: 'Free parking, bike rack at entrance' },
    { miles: '2.1', instruction: 'Stay straight at river fork junction', note: 'Left fork adds 3 miles' },
    { miles: '5.5', instruction: 'Cross the meadow bridge', note: 'Slow down — pedestrian traffic' },
    { miles: '8.0', instruction: 'Pass Scoops on the Trail on the right', note: 'Open Sat–Sun 10am–6pm' },
    { miles: '11.2', instruction: 'Enter the arboretum section', note: 'Speed limit 10 mph' },
    { miles: '12.0', instruction: 'Loop complete — back at South Trailhead' },
  ],
  gearTips: [
    'Any bike works — hybrid, cruiser, road, or mountain',
    'No specialist gear needed; helmet and comfortable clothes are all you need',
    'Bring a lock if you plan to stop at the café or community gardens',
    'Great route for e-bikes and cargo bikes — path is wide and smooth throughout',
  ],
};

export function buildFallbackRoute(query: string): RouteData {
  const preview = query.length > 55 ? `${query.slice(0, 55)}…` : query;
  return {
    id: 'custom',
    name: 'Custom Route Blueprint',
    tagline: `AI-generated route based on: "${preview}"`,
    distanceMiles: 18,
    elevationFt: 650,
    estimatedTime: '1h 45m',
    difficulty: 'Moderate',
    surfaces: [
      { label: 'Road', percentage: 60 },
      { label: 'Path', percentage: 40 },
    ],
    overview:
      'Based on your query, VeloMind has assembled a route blueprint that balances accessibility with exploration. The 18-mile loop combines quiet residential streets with dedicated path sections, keeping traffic exposure minimal while delivering enough terrain variety to stay engaging throughout.',
    highlights: [
      'Scenic connector path through the central park district',
      'Quiet residential streets with minimal traffic',
      'Mid-route rest stop with water and seating at Mile 9',
      'Gradual elevation variation — nothing too demanding',
    ],
    turns: [
      { miles: '0.0', instruction: 'Depart from suggested start point', note: 'Adjust to your nearest trailhead' },
      { miles: '4.5', instruction: 'Join the dedicated path network', note: 'Watch for pedestrians at peak hours' },
      { miles: '9.0', instruction: 'Mid-route rest stop', note: 'Water and seating available' },
      { miles: '14.2', instruction: 'Re-join surface roads heading south', note: 'Quiet residential traffic' },
      { miles: '18.0', instruction: 'Return to start' },
    ],
    gearTips: [
      'Hybrid or road bike recommended for the mixed surface sections',
      'Standard cycling kit appropriate — no specialist gear needed',
      'Bring 1–2 water bottles depending on the weather',
      'This blueprint can be refined — try a more specific query for better results',
    ],
  };
}
