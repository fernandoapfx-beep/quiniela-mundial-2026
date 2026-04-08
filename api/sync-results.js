// api/sync-results.js
// Cron job que actualiza resultados automáticamente desde football-data.org
// Se ejecuta cada 5 minutos durante el Mundial

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;

// Cliente Supabase simple con fetch
async function supabaseQuery(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error: ${err}`);
  }
  return res.status === 204 ? null : res.json();
}

function calcPoints(ph, pa, ah, aa) {
  if (ah === null || aa === null) return null;
  if (ph === ah && pa === aa) return 5;
  const pr = ph > pa ? 'H' : ph < pa ? 'A' : 'D';
  const ar = ah > aa ? 'H' : ah < aa ? 'A' : 'D';
  return pr === ar ? 3 : 0;
}

export default async function handler(req, res) {
  // Verificar que es un cron job de Vercel o una llamada autorizada
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    console.log('🔄 Iniciando sincronización de resultados...');

    // 1. Traer partidos LIVE o recién terminados de football-data.org
    const apiRes = await fetch(
      'https://api.football-data.org/v4/competitions/WC/matches?status=LIVE,FINISHED',
      { headers: { 'X-Auth-Token': FOOTBALL_API_KEY } }
    );
    const apiData = await apiRes.json();

    if (!apiData.matches?.length) {
      return res.status(200).json({ message: 'Sin partidos en curso', updated: 0 });
    }

    const phaseMap = {
      GROUP_STAGE:    'GROUP',
      ROUND_OF_16:   'KNOCKOUT',
      QUARTER_FINALS:'KNOCKOUT',
      SEMI_FINALS:   'KNOCKOUT',
      THIRD_PLACE:   'KNOCKOUT',
      FINAL:         'KNOCKOUT',
    };

    let updated = 0;

    for (const m of apiData.matches) {
      if (!m.score?.fullTime?.home === null && m.status !== 'LIVE') continue;

      const homeScore = m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? null;
      const awayScore = m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? null;
      const status    = m.status === 'FINISHED' ? 'FINISHED' : m.status === 'IN_PLAY' ? 'LIVE' : 'SCHEDULED';

      // Buscar el partido en nuestra base de datos
      const matches = await supabaseQuery(`matches?external_id=eq.${m.id}&select=id,home_score,away_score,status`);
      if (!matches?.length) continue;

      const dbMatch = matches[0];

      // Solo actualizar si hay cambio
      if (dbMatch.status === status && dbMatch.home_score === homeScore && dbMatch.away_score === awayScore) continue;

      // Actualizar partido
      await supabaseQuery(
        `matches?id=eq.${dbMatch.id}`,
        'PATCH',
        { home_score: homeScore, away_score: awayScore, status }
      );

      // Si terminó, calcular puntos de todas las predicciones
      if (status === 'FINISHED' && homeScore !== null && awayScore !== null) {
        const preds = await supabaseQuery(`predictions?match_id=eq.${dbMatch.id}&select=id,predicted_home,predicted_away`);
        
        for (const pred of (preds || [])) {
          const pts = calcPoints(pred.predicted_home, pred.predicted_away, homeScore, awayScore);
          await supabaseQuery(`predictions?id=eq.${pred.id}`, 'PATCH', { points: pts });
        }
      }

      updated++;
      console.log(`✅ Actualizado: ${m.homeTeam.name} ${homeScore}-${awayScore} ${m.awayTeam.name} [${status}]`);
    }

    console.log(`🏁 Sincronización completa: ${updated} partidos actualizados`);
    return res.status(200).json({ 
      message: 'Sincronización exitosa', 
      updated,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error en sync-results:', error);
    return res.status(500).json({ error: error.message });
  }
}
