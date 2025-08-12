import { useEntities } from "~/store/useEntities";
import { highlight } from "./highLight";

export default function EntityCard({ uuid }: { uuid: string }) {
  const entity = useEntities(state => state.entitiesMap[uuid]);
  const { query } = useEntities();

  return (<div className="bg-amber-200 flex flex-col gap-5 w-full">
    <span className="text-blue-950">{highlight(entity.name, query)}</span>
    <p className="text-blue-500">{highlight(entity.description, query)}</p>
  </div>)
}