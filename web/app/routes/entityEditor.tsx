import type { Route } from "./+types/entity";
import EntityClaimEditor from "./editor";

export default function EntityEditorPage({
  params,
}: Route.ComponentProps) {
  return <EntityClaimEditor uuid={params.uuid}/>
}
