import EntityIcon from "~/components/EntityIcon";
import type { Route } from "./+types/entity";
import { useEntities } from "~/store/useEntities";
import ClaimCard from "~/components/ClaimCard";
import { Link } from "react-router";

export default function EntityPage({
  params,
}: Route.ComponentProps) {
  const entity = useEntities((state)=>state.entitiesMap[params.uuid])
  const claimids = useEntities((state)=>state.entityClaims[params.uuid])
  return (
    <div className="relative mx-auto max-w-[525px] rounded-lg bg-white px-10 py-16 text-center sm:px-12 md:px-[60px]">
      <div className="flex flex-col items-center w-full gap-5">
        <p>Entity UUID: {params.uuid}</p>
        <EntityIcon size={40} label={entity.type}></EntityIcon>
        <span>{entity.name}</span>
        <span>{entity.description}</span>
        <Link to={`/entity/${params.uuid}/edit`}>
        <span className="text-blue-400 underline">edit</span>
        </Link>
        {claimids.map(cuuid => (<ClaimCard key={cuuid} cuuid={cuuid} omitEntities={[params.uuid]}></ClaimCard>))}
      </div>
    </div>
  );
}
