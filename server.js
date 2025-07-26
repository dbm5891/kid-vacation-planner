const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// MIME types for serving static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// Helper to fetch JSON from a URL via HTTPS
function fetchJSON(requestUrl) {
  return new Promise((resolve, reject) => {
    https.get(requestUrl, (resp) => {
      let data = '';
      resp.on('data', (chunk) => (data += chunk));
      resp.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', (err) => reject(err));
  });
}

// Geocode a place name using Nominatim
async function geocode(city) {
  const endpoint = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
  const results = await fetchJSON(endpoint);
  if (results && results.length > 0) {
    return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
  }
  throw new Error('No results');
}

// Build Overpass query string based on categories
function buildOverpassQuery(lat, lon, radius, categories) {
  const queries = categories.map((cat) => {
    switch (cat) {
      case 'playground':
        return `node[leisure=playground](around:${radius},${lat},${lon});`;
      case 'park':
        return `node[leisure=park](around:${radius},${lat},${lon});`;
      case 'theme_park':
        return `node[tourism=theme_park](around:${radius},${lat},${lon});`;
      case 'zoo':
        return `node[tourism=zoo](around:${radius},${lat},${lon});`;
      case 'museum':
        return `node[tourism=museum](around:${radius},${lat},${lon});`;
      case 'water_park':
        return `node[leisure=water_park](around:${radius},${lat},${lon});`;
      default:
        return '';
    }
  });
  return `[out:json][timeout:25];(${queries.join('')});out body;`;
}

// Fetch activities from Overpass API
async function fetchActivities(lat, lon, radius, categories) {
  const query = buildOverpassQuery(lat, lon, radius, categories);
  const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  const data = await fetchJSON(overpassUrl);
  const elements = data.elements || [];
  return elements.map((el, idx) => {
    let category = 'unknown';
    if (el.tags) {
      if (el.tags.leisure === 'playground') category = 'playground';
      else if (el.tags.leisure === 'park') category = 'park';
      else if (el.tags.tourism === 'theme_park') category = 'theme_park';
      else if (el.tags.tourism === 'zoo') category = 'zoo';
      else if (el.tags.tourism === 'museum') category = 'museum';
      else if (el.tags.leisure === 'water_park') category = 'water_park';
    }
    return {
      id: el.id || idx,
      name: (el.tags && el.tags.name) || '(unnamed)',
      category,
      lat: el.lat,
      lon: el.lon,
    };
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/api/geocode') {
    const city = parsed.query.city;
    if (!city) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing city' }));
      return;
    }
    try {
      const coords = await geocode(city);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(coords));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  if (parsed.pathname === '/api/activities') {
    const lat = parseFloat(parsed.query.lat);
    const lon = parseFloat(parsed.query.lon);
    const radius = parseFloat(parsed.query.radius);
    const categories = (parsed.query.categories || '').split(',').filter(Boolean);
    if (isNaN(lat) || isNaN(lon) || isNaN(radius) || categories.length === 0) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid parameters' }));
      return;
    }
    try {
      const results = await fetchActivities(lat, lon, radius, categories);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ results }));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  // Serve static files from the public directory
  const filePath = path.join(__dirname, 'public', parsed.pathname === '/' ? 'index.html' : parsed.pathname);
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.statusCode = 500;
        res.end('Internal server error');
        return;
      }
      const ext = path.extname(filePath);
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      res.end(content);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
