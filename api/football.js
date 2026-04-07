export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { endpoint } = req.query;
  if (!endpoint) return res.status(400).json({ error: 'Falta endpoint' });

  const API_KEY = process.env.FOOTBALL_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'FOOTBALL_API_KEY no configurada' });

  try {
    const url = `https://api.football-data.org/v4/${endpoint}`;
    const response = await fetch(url, { headers: { 'X-Auth-Token': API_KEY } });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error al conectar con football-data.org' });
  }
}
