import { apiEnvironment, handleApiRequest } from '../server/api.js'

/** Vercel-compatible Web handler; the same shared module serves the local dev API. */
export function GET(request: Request): Promise<Response> {
  return handleApiRequest(request, apiEnvironment(process.env))
}
