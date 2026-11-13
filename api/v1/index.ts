import { respond } from '../../src/api/handlers.js';

export function GET(req: Request) {
  return respond(req, 'index');
}
export function OPTIONS(req: Request) {
  return respond(req, 'index');
}
