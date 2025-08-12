import { useEntities } from "~/store/useEntities";
import EntityIcon from "./EntityIcon";
import { Link } from "react-router";

export default function ClaimCard({ omitEntities, cuuid }: { omitEntities: string[], cuuid: string }) {
  const { predicate, description, args, value_str } = useEntities(state => state.claimsMap[cuuid]);
  const entitiesMap = useEntities(state => state.entitiesMap);

  return (<div className="bg-green-200 flex flex-col gap-5 w-full">
    <span className="text-blue-950">{predicate}</span>
    {args.length <= 1
      ? <span className="text-blue-500">value:{value_str}</span>
      : <>
        <span className="text-blue-500">relevant nodes:</span>
        <table>
          <thead>
            <tr>
              <th>role</th>
              <th>node</th>
            </tr></thead>
          <tbody>
            {args.filter((arg) => !(arg.node_uuid in omitEntities)).map((arg) => (<tr key={arg.node_uuid}>
              <td><span>{arg.role}</span></td>
              <td>
                <Link to={`/entity/${arg.node_uuid}`} className="flex flex-row justify-centers items-center gap-5">
                <EntityIcon label={entitiesMap[arg.node_uuid].type} size={20} />
                <span>{entitiesMap[arg.node_uuid].name}</span></Link>
              </td>
            </tr>))}</tbody>
        </table>
      </>}
    <p className="text-blue-500">{description}</p>
  </div>)
}