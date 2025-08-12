import React, { useState } from "react";
import { useForm, useFieldArray, Controller, useWatch, type UseFormRegister, type FieldErrors, type Control } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEntities } from "~/store/useEntities";
import { WithUUID, ZClaimArgDTO, ZClaimDTO, ZEntityDTO, ZFormSchema, type Claim, type ClaimArg, type Entity, type EntityDTO, type FormValues, type NodeType } from "@my-repo/shared-types";
import { PiX } from 'react-icons/pi';

// ——————————————————————————————————————————
// Types
// ——————————————————————————————————————————
// export type NodeType = "Person" | "Place" | "Event" | "Concept";

// export type NodeOption = {
//   uuid: string;
//   label: string; // display text
//   type: NodeType;
// };

// const ArgSchema = z.object({
//   role: z.string().min(1, "Role is required"),
//   nodeUuid: z.string().min(1, "Select a node"),
//   position: z.number().int().optional(),
// });

// const ClaimSchema = z.object({
//   predicate: z.string().min(1, "Predicate is required"),
//   description: z.string().optional(),
//   args: z.array(ArgSchema).min(1, "At least one argument"),
// });

// const EntitySchema = z.object({
//   uuid: z.string().optional(),
//   type: z.enum(["Person", "Place", "Event", "Concept"]),
//   name: z.string().min(1, "Name is required"),
//   description: z.string().optional(),
// });

// const FormSchema = z.object({
//   entity: EntitySchema,
//   claims: z.array(ClaimSchema),
// });


export const INTRINSIC_PREDICATES = [
  "born_in",
  "learned_about",
  "attended",
  "introduced",
  "likes",
  "mbti",
] as const;

export type IntrinsicPredicate = (typeof INTRINSIC_PREDICATES)[number];

export const isIntrinsicPredicate = (p?: string): p is IntrinsicPredicate =>
  !!p && (INTRINSIC_PREDICATES as readonly string[]).includes(p);

// Backend DTOs
// export type NodeRef = { type: NodeType; key: "uuid"; value: string };
// export type CreateClaimDTO = {
//   predicate: string;
//   description?: string;
//   args: { role: string; position?: number; entity: NodeRef }[];
//   meta?: { confidence?: number };
// };

// ——————————————————————————————————————————
// Helpers
// ——————————————————————————————————————————
const rolesForPredicate = (predicate: string): string[] => {
  switch (predicate) {
    case "born_in":
      return ["subject", "object"]; // Person, Place
    case "learned_about":
      return ["subject", "object", "via_person", "at_event"]; // Person, Concept, Person?, Event?
    case "attended":
      return ["subject", "object", "at_place"]; // Person, Event, Place
    case "introduced":
      return ["introducer", "introduced", "to", "at_event"]; // Person, Person, Person, Event
    default:
      // Allow free-form roles for custom predicates
      return ["subject", "object"]; // sensible default
  }
};

const guessDefaultArgs = (predicate: string): { role: string }[] => {
  const roles = rolesForPredicate(predicate);
  return roles.slice(0, 2).map((r) => ({ role: r }));
};

// const findNodeByUuid = (opts: NodeOption[], uuid: string) =>
//   opts.find((o) => o.uuid === uuid);

// const nodeRefFromUuid = (opts: NodeOption[], uuid: string): NodeRef => {
//   const n = findNodeByUuid(opts, uuid);
//   if (!n) throw new Error("Unknown node uuid: " + uuid);
//   return { type: n.type, key: "uuid", value: n.uuid };
// };

// ——————————————————————————————————————————
// UI Bits
// ——————————————————————————————————————————
const FieldError: React.FC<{ msg?: string }> = ({ msg }) =>
  msg ? <p className="text-xs text-red-600 mt-1">{msg}</p> : null;

// Small pill
const Pill: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-gray-700 border-gray-200 bg-gray-50">
    {children}
  </span>
);

// function EntityToDTO(entity: Entity): EntityDTO {
//   const type = entity.labels[0];
//   assertNodeType(type); // throws if invalid
//   return { type, ...entity };
// }

// ——————————————————————————————————————————
// Main Component
// ——————————————————————————————————————————
export default function EntityClaimEditor(props: {
  uuid: string
}) {
  const entities = useEntities((state) => state.entitiesMap)
  const claimids = useEntities((state) => state.entityClaims[props.uuid])
  const claims = useEntities((state) => state.claimsMap)
  const updateEntity = useEntities((state) => state.updateEntity)

  const originalValue: FormValues = {
    entity: entities[props.uuid],
    claims: claimids.map(cid => { return { ...claims[cid], custom: !(claims[cid].predicate in INTRINSIC_PREDICATES) } })
  }
  // const nodeOptions: NodeOption[] = props.nodeOptions ?? [
  //   // Demo data (replace by API-fed options)
  //   { uuid: "person-me", label: "Shimin Chen (Person)", type: "Person" },
  //   { uuid: "person-john", label: "John Doe (Person)", type: "Person" },
  //   { uuid: "person-kate", label: "Kate Li (Person)", type: "Person" },
  //   { uuid: "place-indonesia", label: "Indonesia (Place)", type: "Place" },
  //   { uuid: "place-nus", label: "NUS (Place)", type: "Place" },
  //   { uuid: "event-reunion-2024", label: "Reunion 2024 (Event)", type: "Event" },
  //   { uuid: "event-ee1111a-lecture1-2025", label: "EE1111A L1 2025 (Event)", type: "Event" },
  //   { uuid: "concept-scallop-theorem", label: "Scallop theorem (Concept)", type: "Concept" },
  // ];

  const methods = useForm<FormValues>({
    resolver: zodResolver(ZFormSchema),
    defaultValues: originalValue,
    mode: "onChange",
  });

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = methods;

  const claimsFA = useFieldArray({ control, name: "claims" });

  const addClaim = () => {
    // start with an empty predicate; user selects and we can scaffold args later
    claimsFA.append({ predicate: "", description: "", args: [{ node_uuid: props.uuid, position: 0, role: "subject" }], confidence: 1 });
  };

  const removeClaim = (i: number) => claimsFA.remove(i);

  const onSubmit = (values: FormValues) => {
    // For demo just log
    // eslint-disable-next-line no-console
    console.log("SUBMIT", values);
    updateEntity(WithUUID(values));
  };

  return (
    <div className="mx-auto max-w-5xl p-2 space-y-2">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Entity & Claim Editor</h1>

        {/* Entity Card */}
        <div className="rounded-2xl border bg-white shadow-sm p-2 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Entity</h2>
            <Pill>Minimal schema</Pill>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="flex flex-col">
              <label className="text-sm text-gray-600 mb-1">Type</label>
              <select
                className="rounded-lg border px-2 py-1"
                {...register("entity.type")}
              >
                {(["Person", "Place", "Event", "Concept"] as NodeType[]).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col sm:col-span-1">
              <label className="text-sm text-gray-600 mb-1">Name</label>
              <input
                className="rounded-lg border px-2 py-1"
                placeholder="e.g., John Doe"
                {...register("entity.name")}
              />
              <FieldError msg={errors.entity?.name?.message as string} />
            </div>
            <div className="flex flex-col sm:col-span-2">
              <label className="text-sm text-gray-600 mb-1">Description</label>
              <textarea
                className="rounded-lg border px-2 py-1 min-h-[72px]"
                placeholder="A short description"
                {...register("entity.description")}
              />
            </div>
          </div>
        </div>

        {/* Claims */}
        <div className="rounded-2xl border bg-white shadow-sm p-2 flex flex-col gap-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-medium">Claims</h2>
            <button
              type="button"
              onClick={addClaim}
              className="inline-flex items-center rounded-lg bg-black text-white px-2 py-1.5 text-sm hover:bg-gray-800"
            >
              + Add claim
            </button>
          </div>

          {claimsFA.fields.length === 0 && (
            <p className="text-sm text-gray-500">No claims yet. Click “Add claim”.</p>
          )}

          {claimsFA.fields.map((field, i) => (
            <ClaimCard
              key={field.id}
              index={i}
              control={control}
              register={register}
              errors={errors}
              remove={() => removeClaim(i)}
            />
          ))}
        </div>
        <div className="pt-2r">
          <input
            type="submit"
            className="w-full inline-flex justify-center items-center rounded-lg bg-blue-600 text-white px-4 py-1 text-sm font-medium hover:bg-blue-700"
          >
          </input>
        </div>
      </form>
    </div>
  );
}

// ——————————————————————————————————————————
// Claim Card with nested useFieldArray for args
// ——————————————————————————————————————————
function ClaimCard({
  index,
  control,
  register,
  errors,
  remove,
}: {
  index: number;
  control: Control<FormValues>;
  register: UseFormRegister<FormValues>;
  errors: FieldErrors<FormValues>;
  remove: () => void;
}) {
  const entities = useEntities((state) => state.entitiesMap)
  // Nested FieldArray for args of this claim
  const argsFA = useFieldArray({ control, name: `claims.${index}.args` as const });

  // Read current predicate to suggest role options
  // Using Controller is optional; here we stick to register for simplicity
  const predicatePath = `claims.${index}.predicate` as const;

  const [curPos, setCurPos] = useState(1);

  // const addScaffoldedArgs = () => {
  //   // When user selected a predicate, scaffold typical roles
  //   const predicate = (control._formValues?.claims?.[index]?.predicate as string) || "";
  //   const roles = predicate ? rolesForPredicate(predicate) : ["subject", "object"];

  //   // Create empty role rows if not exist
  //   roles.slice(0, 2).forEach((r) => {
  //     if (!argsFA.fields.some((f) => (f as any).role === r)) {
  //       argsFA.append({ role: r, node_uuid: "" });
  //     }
  //   });
  // };

  return (
    <div className="rounded-xl border p-2 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Claim #{index + 1}</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              argsFA.append({ role: "object", node_uuid: "", position: curPos })
              setCurPos(curPos + 1);
            }}
            className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
            title="Add arg row"
          >
            + Arg
          </button>
          <button
            type="button"
            onClick={remove}
            className="rounded-lg border px-2 py-1 text-xs text-red-600 border-red-200 hover:bg-red-50"
            title="Remove claim"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {/* 开关 */}
        {/* <div className="flex flex-col">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              {...register(`claims.${index}.custom` as const)}
            />
            <span className="text-sm">Custom predicate</span>
          </label>
        </div> */}
        <div className="flex flex-col">
          <label className="text-sm text-gray-600 mb-1">Predicate</label>
          {/*useCustom
          ? <input
            className="rounded-lg border px-2 py-1"
            placeholder="Custom predicate"
            {...register(predicatePath)}
          /> 
          : <select
            className="rounded-lg border px-2 py-1"
            {...register(predicatePath)}
            onChange={(e) => {
              register(predicatePath).onChange(e);
              addScaffoldedArgs();
            }}
          >
            <option value="">— Select —</option>
            <option value="born_in">born_in</option>
            <option value="learned_about">learned_about</option>
            <option value="attended">attended</option>
            <option value="introduced">introduced</option>
            <option value="likes">likes</option>
            <option value="mbti">mbti</option>
            <option value="custom">custom</option>
          </select>*/}
          <input
            className="rounded-lg border px-2 py-1"
            placeholder="Predicate"
            {...register(`claims.${index}.predicate` as const)}
          />
          <FieldError msg={errors?.claims?.[index]?.predicate?.message as string} />
        </div>
        <div className="md:col-span-2 flex flex-col">
          <label className="text-sm text-gray-600 mb-1">Description</label>
          <textarea
            className="rounded-lg border px-2 py-1"
            placeholder="Optional description"
            {...register(`claims.${index}.description` as const)}
          />
        </div>
        <div className="md:col-span-2 flex flex-col">
          <label className="text-sm text-gray-600 mb-1">Value</label>
          <input
            className="rounded-lg border px-2 py-1"
            placeholder="Optional Value"
            {...register(`claims.${index}.value_str` as const)}
          />
        </div>
      </div>

      {/* Args table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-gray-600">
              <th className="px-2">Role</th>
              <th className="px-2">Node</th>
              <th className="px-2">Pos</th>
              <th className="px-2"></th>
            </tr>
          </thead>
          <tbody>
            {argsFA.fields.map((arg, j) => (
              <tr key={arg.id} className="">
                <td className="align-middle">
                  <input
                    className="rounded-lg border px-2 py-1 w-22"
                    placeholder="role"
                    {...register(`claims.${index}.args.${j}.role` as const)}
                  />
                  <FieldError msg={errors?.claims?.[index]?.args?.[j]?.role?.message as string} />
                </td>
                <td className="align-middle">
                  <select
                    className="rounded-lg border px-2 py-1 w-34"
                    {...register(`claims.${index}.args.${j}.node_uuid` as const)}
                  >
                    <option value="">— Select node —</option>
                    {Object.values(entities).map((n) => (
                      <option key={n.uuid} value={n.uuid}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                  <FieldError msg={errors?.claims?.[index]?.args?.[j]?.node_uuid?.message as string} />
                </td>
                <td className="align-middle">
                  <input
                    type="number"
                    className="rounded-lg border px-2 py-1 w-10"
                    placeholder="e.g., 0"
                    {...register(`claims.${index}.args.${j}.position` as const, {
                      valueAsNumber: true,
                    })}
                  />
                </td>
                <td className="align-middle">
                  <button
                    type="button"
                    onClick={() => argsFA.remove(j)}
                    className="rounded-lg border px-2 py-1 text-xs text-red-600 border-red-200 hover:bg-red-50"
                  >
                    <PiX />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {typeof errors?.claims?.[index]?.args?.message === "string" && (
        <FieldError msg={errors.claims[index].args.message as string} />
      )}
    </div>
  );
}
