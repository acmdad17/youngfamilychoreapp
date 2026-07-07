addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': '*',
      }
    });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response('Missing ?url= parameter', { status: 400 });
  }

  try {
    const response = await fetch(target, {
      headers: { 'User-Agent': 'YoungFamilyCalendar/1.0' }
    });
    const text = await response.text();
    return new Response(text, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=300',
      }
    });
  } catch (e) {
    return new Response('Fetch failed: ' + e.message, { status: 500 });
  }
}
