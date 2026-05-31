import { homeHtml } from '../generated/home-html.js';

export const config = {
  runtime: 'edge',
};

export default function handler(): Response {
  return new Response(homeHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
