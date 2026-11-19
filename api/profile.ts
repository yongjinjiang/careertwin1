import { apiEnvironment, handleApiRequest } from '../server/api.js'

/** Vercel-compatible Web handler; read-only access to the verified caller's private Profile. */
export function GET(request: Request): Promise<Response> {
  return handleApiRequest(request, apiEnvironment(process.env))
}
