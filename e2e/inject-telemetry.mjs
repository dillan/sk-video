// Sends a short burst of realistic Signal K deltas over the WebSocket stream, so the demo dashboard
// shows live-looking boat data (position, speed, heading, wind, depth, water temp). Best-effort:
// exits quietly if it can't connect. Needs Node with a global WebSocket (Node 22+).
//
//   node inject-telemetry.mjs <http base url> <seconds>

const base = process.argv[2] || 'http://localhost:3000';
const seconds = Number(process.argv[3] || 8);
const wsUrl = base.replace(/^http/, 'ws').replace(/\/$/, '') + '/signalk/v1/stream?subscribe=none';

if (typeof WebSocket === 'undefined') {
  console.log('  (no global WebSocket; skipping telemetry)');
  process.exit(0);
}

// A boat motoring out of Victoria, BC — synthetic but realistic.
let t = 0;
function sample() {
  t += 1;
  const wobble = (amp, period) => amp * Math.sin(t / period);
  return [
    ['navigation.position', { latitude: 48.4159 + wobble(0.0006, 9), longitude: -123.3702 + wobble(0.0008, 11) }],
    ['navigation.speedOverGround', 3.1 + wobble(0.25, 5)],          // ~6 kn
    ['navigation.courseOverGroundTrue', 2.03 + wobble(0.05, 7)],    // rad
    ['navigation.headingTrue', 1.98 + wobble(0.06, 6)],
    ['navigation.speedThroughWater', 3.0 + wobble(0.2, 5)],
    ['environment.depth.belowTransducer', 12.4 + wobble(1.5, 8)],
    ['environment.wind.speedApparent', 6.2 + wobble(0.8, 4)],       // ~12 kn
    ['environment.wind.angleApparent', -0.62 + wobble(0.12, 6)],
    ['environment.water.temperature', 285.95 + wobble(0.2, 13)],    // ~12.8 °C
    ['environment.outside.temperature', 291.1 + wobble(0.3, 17)]    // ~18 °C
  ];
}

function delta() {
  return JSON.stringify({
    context: 'vessels.self',
    updates: [
      {
        source: { label: 'sk-video-demo', type: 'demo' },
        timestamp: new Date(1700000000000 + t * 1000).toISOString(),
        values: sample().map(([path, value]) => ({ path, value }))
      }
    ]
  });
}

const ws = new WebSocket(wsUrl);
let timer;
ws.addEventListener('open', () => {
  ws.send(delta());
  timer = setInterval(() => {
    try {
      ws.send(delta());
    } catch {
      /* ignore */
    }
  }, 1000);
  setTimeout(() => {
    clearInterval(timer);
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    console.log(`  sent ${t} telemetry updates`);
    process.exit(0);
  }, seconds * 1000);
});
ws.addEventListener('error', () => {
  console.log('  (could not connect to the Signal K stream; skipping telemetry)');
  process.exit(0);
});
