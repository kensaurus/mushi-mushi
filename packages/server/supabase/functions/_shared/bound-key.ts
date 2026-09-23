/**
 * A project API key is bound to one project; the api authenticates it as the
 * key's owner. Membership checks keyed on that owner (userCanAccessProject)
 * would otherwise let a key minted for project A act on any other project the
 * owner can reach. Org-scoped keys have no bound project and keep the owner's
 * access. Pure, so the rule is unit-tested without loading the api.
 */
export function boundKeyTargetsOtherProject(
  authMethod: unknown,
  boundProjectId: unknown,
  projectId: string,
): boolean {
  return (
    authMethod === 'apiKey' &&
    typeof boundProjectId === 'string' &&
    boundProjectId !== '' &&
    boundProjectId !== projectId
  )
}
