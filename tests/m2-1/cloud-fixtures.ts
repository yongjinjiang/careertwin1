/** Disposable identity creation for the cloud suite; separate so its safety can be tested with stubs. */
export interface FixtureAdmin {
  createUser(attributes: { email: string; email_confirm: boolean; app_metadata: Record<string, string> }): Promise<{ data: { user: { id: string } | null }; error: { code?: string; status?: number } | null }>
  generateLink(parameters: { type: 'magiclink'; email: string }): Promise<{ data: { user: { id: string } | null; properties: { email_otp: string } | null }; error: { code?: string; status?: number } | null }>
}

/**
 * Only a successful createUser proves this run owns the identity, so only that id is tracked for
 * deletion. generateLink also succeeds for existing users and therefore never decides ownership.
 */
export async function createDisposableIdentity(admin: FixtureAdmin, email: string, runId: string, track: (id: string) => void) {
  const created = await admin.createUser({ email, email_confirm: true, app_metadata: { careertwin1_m21_fixture: runId } })
  if (created.error || !created.data.user) throw new Error(`Fixture user creation failed: ${created.error?.code ?? created.error?.status ?? 'no user'}`)
  const id = created.data.user.id
  track(id)
  const link = await admin.generateLink({ type: 'magiclink', email })
  if (link.error || !link.data.properties) throw new Error(`Fixture code generation failed: ${link.error?.code ?? link.error?.status ?? 'no code'}`)
  if (link.data.user?.id !== id) throw new Error('Fixture code was generated for a different identity')
  return { id, code: link.data.properties.email_otp }
}
