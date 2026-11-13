import { respond } from '../../src/api/handlers.js';

function action(req: Request): string {
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  return decodeURIComponent(path.split('/').pop() ?? '');
}

export function GET(req: Request) {
  return respond(req, action(req));
}
export function POST(req: Request) {
  return respond(req, action(req));
}
export function OPTIONS(req: Request) {
  return respond(req, action(req));
}
